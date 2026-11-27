import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../package.json');
import { registerDrogasilTools, shoppingInstructions } from 'drogasil-cli/mcp-tools';
import { retailPartners } from './providers.js';
import { operations, request, schemas } from './index.js';

const descriptions = {
  retailers: 'List supported Brazilian retailers and the stock and price evidence each can provide.',
  search: 'Search one or all four catalogs without a CEP. On an empty first Pague Menos page, offer returned suggestions as search terms and wait for the user to choose. Search again with the chosen query and the same retailer. For ingredient questions use the reported activeIngredients as evidence. An empty ingredient list means unconfirmed.',
  suggest: 'Complete a partial Pague Menos search term without looking up products or requiring a CEP. Return the terms for the user to choose. Pass the selected term and retailerId to pharmacy_search as query and retailer.',
  product: 'Read facts and online prices for a retailer-specific SKU. Do not infer a prescription rule from a missing fact.',
  stock: 'Check one retailer and SKU at the supplied location. Drogasil also accepts exact coordinates and returns branch quantities, VTEX retailers quote fulfillment, Independente reports city-level branch stock bands. Only report the evidence actually returned.',
  prices: 'Compare the same product across Brazilian pharmacies by CEP. Supply a name, GTIN, Drogasil SKU, or a SKU with its owning retailer. This call identifies every checked chain and returns its status. Rank locally verified prices separately from online-only offers. For choose_reference, let the user identify the pack, then send its retailer and SKU. Ask about generic consent for brand shopping.',
};
export function createServer(monitor = null) {
  const server = new McpServer({ name: 'farmacias-br', version }, {
    instructions: 'Farmácias BR covers Drogasil, Pague Menos, Drogaria São Paulo and Farmácias Independente. Use pharmacy_* for multi-chain work. plan_purchase and find_nearby_stock cover Drogasil branches only. ' + shoppingInstructions
  });
  const registry = monitor ? {
    registerTool(name, options, handler) {
      return server.registerTool(name, options, (args, extra) =>
        monitor.run(name, args, () => handler(args, extra)));
    },
  } : server;
  registerDrogasilTools(registry, z, retailPartners);
  for (const [name, description] of Object.entries(descriptions)) {
    registry.registerTool('pharmacy_' + name, { description, inputSchema: schemas[name],
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: name !== 'retailers' } }, async args => {
      const value = await request(name, args);
      const data = Array.isArray(value) ? { retailers: value } : value;
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    });
  }
  return server;
}

export function localApp(monitor = null) {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('origin') && req.get('origin') !== 'http://' + req.get('host')) return res.sendStatus(403);
    next();
  });
  app.get('/api/v1/retailers', (_req, res) => res.json(operations.retailers()));
  app.post('/api/v1/:operation', async (req, res) => {
    const { operation } = req.params;
    if (!Object.hasOwn(operations, operation)) return res.sendStatus(404);
    const input = schemas[operation].safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'invalid_request', fields: input.error.issues.map(issue => issue.path.join('.')) });
    try {
      const lookup = () => request(operation, input.data);
      res.json(await (monitor ? monitor.run(operation, input.data, lookup) : lookup()));
    }
    catch { res.status(502).json({ error: 'source_failed' }); }
  });
  app.post('/mcp', async (req, res) => {
    const server = createServer(monitor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.once('close', () => { void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.set('Allow', 'POST').sendStatus(405));
  return app;
}
