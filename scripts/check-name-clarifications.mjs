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
  for (const [tool, args] of [
    ['search_products', {query:'predniso', page:1, limit:4}],
    ['compare_products', {query:'predniso', includeGenerics:false}],
    ['get_medication_info', {queries:['predniso','Rivotril']}],
    ['pharmacy_info', {retailer:'drogasil', queries:['predniso','Rivotril']}],
    ['pharmacy_compare', {retailer:'paguemenos', query:'predniso', includeGenerics:false}],
  ]) {
    const pending = await call(tool, args);
    assert.equal(pending.reply, 'Você quis dizer prednisona ou prednisolona?');
    assert.equal(pending.nextTool,tool);
    if (tool === 'search_products') {
      const result = await call(tool, pending.nameChoice.options[0].onSelect);
      assert.ok(result.pages >= 1 && result.products.length);
      assert.ok(result.products.every(p => p.activeIngredients.some(a => /\bprednisona\b/i.test(a))));
      const drops = await call(tool, {query:'Dimorf em gotas'});
      assert.ok(drops.products.length && drops.products.every(p => /solução|gotas/i.test(p.name) && !/comprimido/i.test(p.name)));
    }
    console.log(tool + ' passed');
  }
  const all = ['drogasil','paguemenos','drogariasaopaulo'];
  for (let mask=1; mask<8; mask++) {
    const retailers = all.filter((_, index) => mask & (1 << index));
    const scope = retailers.length === 1 ? {retailer:retailers[0]} : {retailers};
    for (const tool of ['pharmacy_search', 'pharmacy_suggest']) {
      const reply = await call(tool, {...scope, query:'dexa', limit:7});
      assert.equal(reply.interaction, 'awaiting_name_choice');
      const options = reply.nameChoice.options;
      assert.ok(options.some(o => o.term === 'dexametasona'));
      const brand = options.find(o => o.term === 'dexador');
      assert.ok(brand);
      assert.deepEqual(brand.onSelect, {...scope, query:'dexador', limit:7});
      assert.equal(reply.nextTool, 'pharmacy_search');
    }
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
