import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMonitoring, observations } from '../src/monitoring.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const dsn = 'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@example.invalid/2';
test('records the failed basket line, ordinary zero stock, and the successful denominator without personal data', async () => {
  const envelopes = [], journal = [];
  const monitor = createMonitoring(dsn, { journal: line => journal.push(line), send: async (url, init) => {
    assert.ok(url.startsWith('https://example.invalid/api/2/envelope/'));
    envelopes.push(init.body); return new Response('{}');
  } });
  const query = 'Segredo 2 mg 30 comprimidos de liberação imediata';
  const args = { items: [{query}, {query:'123456789'}], origin: {zipcode:'11111-111'} };
  const result = {tables:[{status:'no_reference'}, {status:'no_stock', unavailable:[{name:'Segredo'}],rows:[]}]};
  assert.equal(await monitor.run('plan_purchase', args, async () => result), result);
  await monitor.run('plan_purchase', args, async () => ({status:'needs_generic_preference'}));
  await assert.rejects(monitor.run('pharmacy_stock', {retailer:'paguemenos', sku:'123456789'},
    async () => { throw Error('Segredo upstream request https://address.private/11111-111'); }), /Segredo/);
  await monitor.close();
  const payloads = envelopes.map(e => JSON.parse(e.trim().split('\n')[2]));
  const issues = payloads.filter(p=>p.fingerprint);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues[0].tags, {operation:'plan_purchase', retailer:'drogasil', shape:'name.strength.form.release.pack', outcome:'lookup_miss'});
  assert.equal(issues[1].tags.outcome, 'handler_exception');
  assert.equal(journal.length, 2);
  for (const data of [...envelopes, ...journal]) assert.doesNotMatch(data, /Segredo|123456789|11111|address\.private|authorization/i);
  const metrics = payloads.flatMap(p => p.items ?? []);
  assert.deepEqual(metrics.map(m=>m.attributes.outcome.value).sort(),
    ['clarification','handler_exception','lookup_miss','zero_stock']);
});
test('isolates a source failure from an uncovered area and handles missing SKU entries', () => {
  const rows = observations('pharmacy_prices', {query:'Example'}, { checkedRetailers:[
    {retailer:'Drogasil', status:'online_only'}, {retailer:'Pague Menos',status:'no_exact_match'},
    {retailer:'Farmácias Independente',status:'outside_local_directory'}],
    issues:[{retailer:'Pague Menos',status:'location_lookup_failed',sku:'private'}] });
  assert.deepEqual(rows.map(r=>r.outcome),['ok','upstream_failure','outside_coverage']);
  assert.deepEqual(observations('get_products',{}, {products:[null,{sku:'42'}]}).map(r=>r.outcome),['lookup_miss','ok']);
  assert.equal(observations('find_nearby_stock',{sku:'7'},{scope:'nearest',nearestStore:{quantity:0}})[0].outcome,'zero_stock');
  assert.equal(observations('pharmacy_stock',{sku:'7'},{offers:[{localStatus:'unavailable'}]})[0].outcome,'zero_stock');
  assert.equal(createMonitoring(''),null);
});
test('a broken Sentry transport leaves real MCP results and error behavior intact', async () => {
  const journal = [], warnings = [];
  const monitor = createMonitoring(dsn, { journal:v=>journal.push(v), warn:v=>warnings.push(v), send:async()=>{throw Error('down');} });
  const [c,s] = InMemoryTransport.createLinkedPair();
  const server = createServer(monitor), client = new Client({name:'test',version:'1'});
  try {
    await server.connect(s); await client.connect(c);
    const response = await client.callTool({name:'pharmacy_retailers',arguments:{}});
    assert.equal(response.structuredContent.retailers.length,4);
    monitor.canary(false,'form');
    monitor.serviceExit();
    await new Promise(r=>setImmediate(r));
    await monitor.close();
    assert.equal(journal.length,2); assert.ok(warnings.length);
  } finally { await client.close(); await server.close(); }
});
