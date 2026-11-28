// Live catalog acceptance through stdio MCP. No lookup requires an origin.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({name:'name-clarification-check', version:'1'});
const endpoint = process.env.FARMACIAS_TEST_MCP_URL;
const transport = endpoint
  ? new StreamableHTTPClientTransport(new URL(endpoint))
  : new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js', import.meta.url))],env:{FARMACIAS_SENTRY_DSN:''}});
async function call(name, args) {
  const response = await client.callTool({name, arguments:args}, undefined, {timeout:120000});
  assert.ok(!response.isError, name + ' failed');
  return response.structuredContent;
}
try {
  await client.connect(transport);
  const all = ['drogasil','paguemenos','drogariasaopaulo'];
  for (let mask=1; mask<8; mask++) {
    const retailers = all.filter((_, index) => mask & (1 << index));
    const scope = retailers.length === 1 ? {retailer:retailers[0]} : {retailers};
    const ambiguous = await call('pharmacy_search', {...scope, query:'predniso', limit:3});
    assert.equal(ambiguous.reply, 'Você quis dizer prednisona ou prednisolona?');
    assert.ok(ambiguous.results.every(group => !group.products.length));
    const selected = await call('pharmacy_search', ambiguous.nameChoice.options.find(o => o.term === 'prednisona').onSelect);
    assert.deepEqual(selected.results.map(group => group.retailerId), retailers);
    for (const group of selected.results) {
      assert.ok(group.products.length && group.products.every(product =>
        product.activeIngredients?.some(name => /\bprednisona\b/i.test(name))), group.retailerId);
    }
    const first = await call('pharmacy_search', {...scope, query:'morfi'});
    assert.equal(first.reply, 'Você quis dizer morfina?');
    const declined = await call('pharmacy_suggest', first.confirmation.onNo);
    assert.ok(!['partial','source_failed'].includes(declined.status));
    assert.ok(!declined.suggestions.includes('morfina'));
    const yes = await call('pharmacy_search', first.confirmation.onYes);
    for (const group of yes.results) {
      assert.ok(group.products.length && group.products.every(product =>
        product.activeIngredients?.some(name => /\bmorfina\b/i.test(name))), group.retailerId);
    }
    console.log(retailers.join(' + ') + ' passed');
  }
} finally { await client.close(); }
