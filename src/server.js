import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../package.json');
import { registerDrogasilTools } from 'drogasil-cli/mcp-tools';
import { retailPartners } from './providers.js';
import { operations, request, schemas } from './index.js';

const descriptions = {
  retailers: 'List supported Brazilian retailers and the stock and price evidence each can provide.',
  search: 'Search one or all supported catalogs without a CEP. For a medication name confirmation, ask only confirmation.question verbatim. Stop for the reply. Sim accepts that single term: call pharmacy_search with onYes. Não: call pharmacy_suggest with onNo and show the remaining terms. Use activeIngredients and ingredientEvidence for ingredient questions. Return products only for the requested retailer.',
  suggest: 'Suggest a search term for Pague Menos or Drogaria São Paulo. Always supply the requested retailer. Return suggestions without products or CEP. Ask only confirmation.question and wait. Sim: call pharmacy_search with onYes. Não: call this tool with onNo, list the remaining terms, and wait for a selection. If none remain, ask for another spelling. Use listAll only on an explicit request for all suggestions.',
  compare: 'Compare presentations in one named partner catalog without a CEP. Send a local SKU or a name, after settling brand/generic preference. Show the requested product first, then only generics verified against the reference presentation and the local barcode. Incomplete presentation or partial results can limit the list.',
  basket: 'Check the whole selected basket at one partner retailer in one call. Supply exact local SKUs, quantities and shared CEP. For multiple sellers ask which to use. Pague Menos and São Paulo use a single fulfillment simulation. Only commonPickupPoints apply to all items. A fewest-stores or shortest-route plan is available for Drogasil only.',
  stores: 'Page through the public branch directory for Drogasil. Directory membership alone gives no evidence of shelf stock, distance order or pickup availability.',
  info: 'Get only medication facts from the named retailer by names or SKUs in one call, without a location or price/stock inquiry. Keep strengths with their own titles. Separate prescription, retention and form. Missing labels are unconfirmed. Pages refer to catalog search.',
  snapshot: 'Start an explicitly requested, saved catalog snapshot for one retailer. Read the returned run ID with pharmacy_read_snapshot.',
  read_snapshot: 'Read a page of an existing catalog snapshot. Check state and nextOffset before claiming the run is complete.',
  product: 'Read catalog facts and online prices for one SKU, an ordered batch of SKUs, or one exact barcode. Always supply the owning retailer. Do not infer a prescription rule from a missing fact.',
  stock: 'Check one retailer and SKU at the supplied location. Drogasil also accepts exact coordinates and returns branch quantities, the other retailers quote fulfillment. Only report the evidence actually returned.',
  prices: 'Compare the same product across Brazilian pharmacies by CEP. Supply a name, GTIN, Drogasil SKU, or a SKU with its owning retailer. This call identifies every checked chain and returns its status. Rank locally verified prices separately from online-only offers. For choose_reference, let the user identify the pack, then send its retailer and SKU. Ask about generic consent for brand shopping.',
};

function confirmFirst(group, original) {
  const [term] = group.suggestions ?? [];
  if (!term) return group;
  const retailer = group.retailerId;
  return { ...group, suggestions: [term], confirmation: {
    question: `Você quis dizer ${term}?`,
    onYesTool: 'pharmacy_search', onNoTool: 'pharmacy_suggest',
    onYes: { query: term, retailer },
    onNo: { query: original, retailer, declinedTerm: term },
  } };
}

export function catalogReply(name, args, data) {
  if (name === 'search') return { ...data, results: data.results.map(group => confirmFirst(group, args.query)) };
  if (name === 'suggest' && !args.declinedTerm && !args.listAll) return confirmFirst(data, args.query);
  return data;
}
// Some clients render structuredContent and some read only the text blocks.
export function toolReply(name, args, value) {
  const data = catalogReply(name, args, Array.isArray(value) ? { retailers: value } : value);
  const prompt = data.confirmation ?? (data.results?.length === 1 && data.results[0].confirmation);
  const content = [];
  let structuredContent = data;
  if (prompt) {
    const instructions = [
      'Responda agora com esta pergunta exata e aguarde:',
      prompt.question,
      'Se a pessoa responder “sim”, execute ' + prompt.onYesTool + ' com ' + JSON.stringify(prompt.onYes) + '.',
      'Se responder “não”, busque as outras sugestões com ' + prompt.onNoTool + ' e os argumentos ' +
        JSON.stringify(prompt.onNo) + '. Apresente os termos retornados.',
    ].join('\n');
    structuredContent = { interaction: 'awaiting_confirmation', reply: prompt.question, nextTurn: instructions, ...data };
    content.push({type:'text', text:instructions});
  }
  content.push({type:'text', text:JSON.stringify(structuredContent)});
  return {content, structuredContent};
}

export function createServer(monitor = null) {
  const server = new McpServer({ name: 'farmacias-br', version }, {
    instructions: 'Use pharmacy_* tools for Pague Menos and Drogaria São Paulo. For their factual questions call pharmacy_info without a CEP. For a brand shopping request settle generic preference first. Use pharmacy_compare for local catalog alternatives and pharmacy_basket for selected local SKUs. Drogasil branch planning, nearest-store quantities and 25 km expansion use the Drogasil tools.'
  });
  const registry = monitor ? {
    registerTool(name, options, handler) {
      return server.registerTool(name, options, (args, extra) =>
        monitor.run(name, args, () => handler(args, extra)));
    },
  } : server;
  registerDrogasilTools({
    registerTool(name, options, handler) {
      const shared = ['compare_pharmacy_prices','read_catalog_snapshot'].includes(name);
      const description = shared ? options.description : 'Drogasil only. ' + options.description;
      return registry.registerTool(name,{...options,description},handler);
    },
  }, z, retailPartners);
  for (const [name, description] of Object.entries(descriptions)) {
    registry.registerTool('pharmacy_' + name, { description, inputSchema: schemas[name],
      annotations: { readOnlyHint: name !== 'snapshot', destructiveHint: false, openWorldHint: !['retailers','read_snapshot'].includes(name) } }, async args => {
      const value = await request(name, args);
      return toolReply(name, args, value);
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
