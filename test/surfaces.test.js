import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { localApp } from '../src/server.js';
import { getStock, listRetailers, request, searchCatalog, suggestTerms } from '../src/index.js';
import { observations } from '../src/monitoring.js';

test('one source outage leaves three catalog outcomes and preserves retailer-specific SKU identity', async () => {
  const sources = Object.fromEntries(listRetailers().map(({id}) => [id, { search: async () => [{sku: '1', name: 'Exemplo Genérico'}] }]));
  sources.paguemenos.search = async () => { throw Error('outage'); };
  sources.drogariasaopaulo.search = async () => [];
  const result = await searchCatalog({query:'exemplo'}, sources);
  assert.deepEqual(result.results.map(group=>group.status), ['matches','source_failed','no_match','matches']);
  assert.deepEqual(result.results.flatMap(group=>group.products).map(p=>[p.retailerId,p.sku,p.type]),
    [['drogasil','1','Genérico'],['farmaciaindependente','1','Genérico']]);
});

test('missing coverage, unknown SKU, seller failure and stock bands are distinct', async () => {
  const row = {sku:'31', name:'Produto'}; const options = {retailer:'farmaciaindependente',sku:'31',zipcode:'01001000',quantity:3};
  const provider = {serves:async()=>false, product:async()=>assert.fail()};
  const sources = {farmaciaindependente:provider};
  assert.equal((await getStock(options,sources)).status, 'outside_local_directory');
  provider.serves = async()=>true; provider.product = async()=>[];
  assert.equal((await getStock(options,sources)).status,'unknown_sku');
  provider.product = async()=>[row]; provider.local = async()=>{throw Error('stock outage')};
  assert.equal((await getStock(options,sources)).status,'source_failed');
  provider.local = async(_r,_z,q)=>({...row,quantityVerified:false,requestedQuantity:q,branches:[{reportedStock:'baixo'}]});
  const [a] = (await getStock(options,sources)).offers;
  assert.equal(a.quantityVerified,false); assert.equal(a.requestedQuantity,3);
  assert.equal(a.branches[0].quantity,undefined);
});

test('a Pague Menos prefix returns terms until the caller selects one, then exposes the catalog ingredient', async () => {
  const searched = [], suggested = [];
  const sources = { paguemenos: {
    search: async query => {
      searched.push(query);
      return query === 'morfina' ? [{ sku: '1', name: 'Dimorf', facts: { NomeSubstanciaPrincipioAtivo: ['Morfina'] } }] : [];
    },
    suggest: async query => { suggested.push(query); return ['MORFI', 'morfina']; },
  } };
  const args = { retailer: 'paguemenos', query: 'morfi' };
  const first = await searchCatalog(args, sources);
  const [group] = first.results;
  assert.deepEqual(group, { retailerId: 'paguemenos', status: 'no_match', products: [],
    suggestionStatus: 'suggestions', suggestions: ['morfina'] });
  assert.deepEqual(searched, ['morfi']);
  assert.equal(observations('pharmacy_search', args, first)[0].outcome, 'clarification');
  const chosen = await searchCatalog({ retailer: group.retailerId, query: group.suggestions[0] }, sources);
  assert.deepEqual(chosen.results[0].products[0].activeIngredients, ['Morfina']);
  assert.equal(chosen.results[0].suggestions, undefined);
  await searchCatalog({ ...args, page: 2 }, sources);
  assert.deepEqual(suggested, ['morfi']);
  const terms = await suggestTerms({query: 'morfi'}, sources);
  assert.ok(terms.suggestions.includes('morfina'));
  assert.deepEqual(searched, ['morfi', 'morfina', 'morfi']);
  await assert.rejects(suggestTerms({...args, retailer:'drogasil'}, sources));
});

test('a suggestion outage preserves the catalog miss, and a failed catalog does not initiate suggestions', async () => {
  const args = { retailer: 'paguemenos', query: 'exemplo' };
  let calls = 0;
  const provider = { search: async () => [], suggest: async () => { calls++; throw Error('outage'); } };
  const sources = { paguemenos: provider };
  const first = await searchCatalog(args, sources);
  assert.deepEqual(first.results[0], { retailerId:'paguemenos', status:'no_match', products:[],
    suggestionStatus:'source_failed', suggestions:[] });
  assert.equal(observations('pharmacy_search', args, first)[0].outcome, 'upstream_failure');
  provider.search = async () => { throw Error('outage'); };
  assert.equal((await searchCatalog(args, sources)).results[0].status, 'source_failed');
  assert.equal(calls, 1);
});

test('bounded and strict public inputs', async () => {
  for (const [operation, input] of [
    ['constructor',{}],['search',{query:' '}],['search',{query:'x',limit:51}],['search',{query:'x',retailer:'other'}],
    ['stock',{retailer:'drogasil',sku:'1',zipcode:'00000-000'}],['stock',{retailer:'drogasil',sku:'1',zipcode:'01001000',quantity:-2}],
    ['product',{sku:'2'}],['retailers',{zipcode:'private'}],['prices',{query:'x',zipcode:'wrong'}],
  ]) await assert.rejects(request(operation,input));
});

test('CLI, HTTP, HTTP MCP and stdio MCP expose the same registry', async t => {
  const listener = localApp().listen(0,'127.0.0.1'); await once(listener,'listening');
  t.after(()=>listener.close());
  const url = 'http://127.0.0.1:'+listener.address().port;
  const cli = fileURLToPath(new URL('../bin/farmacias.js',import.meta.url));
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,[cli,'retailers'])),listRetailers());
  assert.deepEqual(await (await fetch(url+'/api/v1/retailers')).json(),listRetailers());
  async function post(path, data, headers={}) {
    return fetch(url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
  }
  assert.equal((await post('/api/v1/prices', {query:'x'})).status,400);
  assert.equal((await post('/api/v1/constructor', {})).status,404);
  assert.equal((await post('/api/v1/retailers', {},{origin:'https://foreign.example'})).status,403);
  const readers = await Promise.all(Array.from({length:24},()=>fetch(url+'/api/v1/retailers').then(r=>r.json())));
  assert.ok(readers.every(data=>data.length===4));
  for (const transport of [new StreamableHTTPClientTransport(new URL(url+'/mcp')),
    new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]})]) {
    const client = new Client({name:'integration',version:'1'}); await client.connect(transport);
    try {
      const {tools} = await client.listTools();
      for (const name of ['plan_purchase','find_nearby_stock','get_medication_info','compare_products','collect_catalog_snapshot','pharmacy_retailers','pharmacy_prices','pharmacy_search','pharmacy_suggest','pharmacy_stock','pharmacy_product']) {
        assert.ok(tools.some(tool=>tool.name===name),name);
      }
      assert.deepEqual((await client.callTool({name:'pharmacy_retailers',arguments:{}})).structuredContent.retailers,listRetailers());
      assert.ok((await client.callTool({name:'pharmacy_stock',arguments:{sku:'1'}})).isError);
    } finally {await client.close()}
  }
});

test('coordinate-only origins reach the point-capable retailer and request a CEP for delivery quotes', async () => {
  const coordinates={latitude:-23.5,longitude:-46.6};
  const row={sku:'42',name:'Example'};
  const sources={drogasil:{product:async()=>[row],local:async(arg,origin)=>{assert.deepEqual(origin,coordinates);return arg}}};
  assert.equal((await getStock({retailer:'drogasil',sku:'42',coordinates},sources)).status,'checked');
  assert.equal((await getStock({retailer:'paguemenos',sku:'42',coordinates})).status,'requires_cep');
  assert.equal((await request('prices',{query:'42',coordinates})).status,'requires_cep');
});

test('an independent name search can resolve a missing primary reference without selecting a near match', async () => {
  const {comparePrices} = await import('../src/index.js');
  const sources=Object.fromEntries(listRetailers().map(({id})=>[id,{search:async()=>[]}]));
  sources.farmaciaindependente.search=async()=>[{sku:'9',name:'Exemplo gotas 20 mL'}];
  const args={query:'Exemplo gotas 30 mL',zipcode:'01001000'};
  for (const compare of [async()=>({status:'no_reference'}), async()=>{ throw Error('unavailable') }]) {
    const r=await comparePrices(args,{compare,sources});
    assert.equal(r.status,'choose_reference'); assert.equal(r.candidates[0].retailerId,'farmaciaindependente');
    assert.ok(!r.verifiedOffers?.length);
  }
});
