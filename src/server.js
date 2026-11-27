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
  search: 'Search one or all four catalogs without a CEP. For a Pague Menos confirmation, ask only confirmation.question verbatim. Stop for the reply. Sim accepts that single term: call pharmacy_search with onYes. Não: call pharmacy_suggest with onNo and show the remaining terms. Use reported activeIngredients for ingredient questions.',
  suggest: 'Suggest a Pague Menos search term without products or CEP. Ask only confirmation.question and wait. Sim: call pharmacy_search with onYes. Não: call this tool with onNo, list the remaining terms, and wait for a selection. If none remain, ask for another spelling. Use listAll only on an explicit request for all suggestions.',
  product: 'Read facts and online prices for a retailer-specific SKU. Do not infer a prescription rule from a missing fact.',
  stock: 'Check one retailer and SKU at the supplied location. Drogasil also accepts exact coordinates and returns branch quantities, VTEX retailers quote fulfillment, Independente reports city-level branch stock bands. Only report the evidence actually returned.',
  prices: 'Compare the same product across Brazilian pharmacies by CEP. Supply a name, GTIN, Drogasil SKU, or a SKU with its owning retailer. This call identifies every checked chain and returns its status. Rank locally verified prices separately from online-only offers. For choose_reference, let the user identify the pack, then send its retailer and SKU. Ask about generic consent for brand shopping.',
};

function confirmFirst(group, original) {
  const [term] = group.suggestions ?? [];
  if (!term) return group;
  const retailer = group.retailerId;
  return { ...group, suggestions: [term], confirmation: {
    question: `Você quis dizer ${term}?`,
    onYes: { query: term, retailer },
    onNo: { query: original, retailer, declinedTerm: term },
  } };
}

export function catalogReply(name, args, data) {
  if (name === 'search') return { ...data, results: data.results.map(group => confirmFirst(group, args.query)) };
  if (name === 'suggest' && !args.declinedTerm && !args.listAll) return confirmFirst(data, args.query);
  return data;
}
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
      const data = catalogReply(name, args, Array.isArray(value) ? { retailers: value } : value);
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
