import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMonitoring, observations } from '../src/monitoring.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const dsn = 'https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@example.invalid/2';
test('a failed snapshot start is reported under its own retailer', () => {
  const rows = observations('pharmacy_snapshot',{queries:['private term']},{runs:[
    {retailerId:'drogariasaopaulo',state:'running',runId:'private-id'},
    {retailerId:'paguemenos',state:'failed',error:'snapshot_start_failed'},
  ]});
  assert.equal(rows.length, 2);
  assert.equal(rows[1].retailer,'paguemenos');
  assert.equal(rows[1].outcome,'upstream_failure');
  assert.doesNotMatch(JSON.stringify(rows),/private/);
});
test('records the failed basket line, ordinary zero stock, and the successful denominator without personal data', async () => {
  const envelopes = [], journal = [];
  const monitor = createMonitoring(dsn, { journal: line => journal.push(line), send: async (url, init) => {
    assert.ok(url.startsWith('https://example.invalid/api/2/envelope/'));
    envelopes.push(init.body); return new Response('{}');
  } });
  const query = 'Segredo 2 mg 30 comprimidos de liberação imediata';
  const args = { retailer:'drogasil', items: [{query}, {query:'123456789'}], origin: {zipcode:'11111-111'} };
  const result = {tables:[{status:'no_reference'}, {status:'no_stock', coverage:{allZero:true}, unavailable:[{name:'Segredo'}],rows:[]}]};
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
    {retailer:'Drogaria São Paulo',status:'outside_local_directory'}],
    issues:[{retailer:'Pague Menos',status:'location_lookup_failed',sku:'private'}] });
  assert.deepEqual(rows.map(r=>r.outcome),['ok','upstream_failure','outside_coverage']);
  assert.deepEqual(observations('get_products',{}, {products:[null,{sku:'42'}]}).map(r=>r.outcome),['lookup_miss','ok']);
  assert.equal(observations('find_nearby_stock',{sku:'7'},{scope:'nearest',nearestStore:{quantity:0}})[0].outcome,'zero_stock');
  assert.equal(observations('pharmacy_stock',{retailer:'paguemenos',sku:'7'},{offers:[{localStatus:'unavailable'}]})[0].outcome,'fulfillment_unavailable');
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
    assert.equal(response.structuredContent.retailers.length,3);
    monitor.canary(false,'form');
    monitor.serviceExit();
    await new Promise(r=>setImmediate(r));
    await monitor.close();
    assert.equal(journal.length,2); assert.ok(warnings.length);
  } finally { await client.close(); await server.close(); }
});

test('tracks checkout and branch evidence independently without reporting a false physical zero', () => {
  const args = {retailer:'paguemenos', sku:'12345678', quantity:3};
  function check(branchInventory, checkout, expected) {
    const rows = observations('pharmacy_stock', args, { offers:[{localStatus:checkout}], branchInventory });
    assert.deepEqual(rows.map(r=>r.operation), ['stock','branch_inventory']);
    assert.deepEqual(rows.map(r=>r.outcome), expected);
    assert.ok(rows.every(r=>r.retailer==='paguemenos' && r.shape==='identifier'));
    assert.doesNotMatch(JSON.stringify(rows), /12345678/);
  }
  const empty = {checkedStores:5, nearbyAllZero:true, unknownStores:0, unknownDistanceStores:0};
  check({status:'source_failed'},'available',['ok','upstream_failure']);
  check({status:'unknown'},'unavailable',['fulfillment_unavailable','stock_unknown']);
  check({status:'unavailable',coverage:empty},'available',['ok','zero_stock']);
  check({status:'unavailable',expanded:true,coverage:empty},'unavailable',['fulfillment_unavailable','no_qualifying_stock']);
  check({status:'available',expanded:true,coverage:empty},'lookup_failed',['upstream_failure','ok']);
  const drug = observations('pharmacy_stock',{retailer:'drogasil',sku:'7'},{
    offers:[{localStatus:'available',coverage:{allZero:true},expandedSearch:{totalStockedStores:1}}]});
  assert.equal(drug[0].outcome,'ok');
});

test('a basket with delivery and unverified pickup reports the directory issue without point or search details',()=>{
  for(const [status,expected] of [['directory_failed','upstream_failure'],['incomplete','stock_unknown']]){
    const args={retailer:'drogariasaopaulo',items:[{query:'private query'}]};
    const result={tables:[{status:'fulfillable',choices:[{localStatus:'available',
      methods:[{channel:'delivery'}],pickupVerification:{status,detail:'private point'}}]}]};
    const [event]=observations('plan_purchase',args,result);
    assert.equal(event.outcome,expected);
    assert.doesNotMatch(JSON.stringify(event),/private/);
  }
});

test('completed basket reports partner subquery incidents once in REST and MCP without disclosing the basket', async () => {
  const {planSelectedBaskets} = await import('../src/named-baskets.js');
  const args = {retailers:['drogasil','paguemenos'], items:['Segredo A','Segredo B'].map(query=>({query,includeGenerics:false})),
    origin:{zipcode:'11111-111'}};
  const plan = async (id, lines) => {
    if (id==='drogasil') return {tables:lines.map(({query})=>({rows:[{sku:query,name:query,referencePriceBRL:3,
      store:{id:'private-branch',name:'Private store',quantity:2,distanceKm:1}}]}))};
    if (lines.length > 1) return {status:'choose_products',tables:lines.map(()=>({status:'matches',choices:[{}]}))};
    if (lines[0].query === 'Segredo A') throw Error('private network details');
    return {status:'unverified'};
  };
  const result=await planSelectedBaskets(args,{plan,clarify:async()=>[]});
  assert.equal(result.crossRetailerPlans.status,'complete');
  const expected=['upstream_failure','pickup_unconfirmed'];
  for (const operation of ['plan','plan_purchase']) {
    const rows=observations(operation,args,result);
    const diagnostics=rows.filter(row=>row.operation==='pickup_quote');
    assert.deepEqual(diagnostics.map(r=>r.outcome),expected);
    assert.ok(diagnostics.every(r=>r.retailer==='paguemenos' && r.shape==='name'));
    assert.equal(rows.filter(row=>row.operation==='plan_purchase').length,4);
    assert.doesNotMatch(JSON.stringify(rows),/Segredo|11111|private/i);
  }
  const envelopes=[],journal=[];
  const monitor=createMonitoring(dsn,{journal:v=>journal.push(v),send:async (_,init)=>{
    envelopes.push(init.body); return new Response('{}');
  }});
  await monitor.run('plan_purchase',args,async()=>({structuredContent:result}));
  await monitor.close();
  assert.deepEqual(journal.map(line=>JSON.parse(line).outcome),expected);
  for (const envelope of envelopes) assert.doesNotMatch(envelope,/Segredo|11111|private/i);
});

test('retries and orders of a joint quote share an incident and a healthy retailer stays outside its group', () => {
  const f=(itemIndices,reason)=>({retailerId:'paguemenos',itemIndices,reason});
  const pickupPlans={lookupFailures:[f([0,1],'pickup_unknown'),f([1,0],'lookup_failed'),f([0,1],'pickup_unknown')]};
  const args={retailer:'paguemenos',items:[{query:'a'},{query:'b'}]};
  const rows=observations('plan',args,{tables:[{status:'matches'},{status:'matches'}],pickupPlans});
  assert.deepEqual(rows.filter(r=>r.operation==='pickup_quote'),[
    {operation:'pickup_quote',retailer:'paguemenos',shape:'joint',outcome:'upstream_failure'}]);
  assert.equal(observations('plan_purchase',{items:args.items},{status:'needs_generic_preference'})[0].retailer,'all');
  assert.equal(observations('plan',args,{tables:[{status:'unavailable'}],pickupPlans:{lookupFailures:[]}}).length,1);
});
