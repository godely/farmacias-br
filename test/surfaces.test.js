import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { localApp } from '../src/server.js';
import { getStock, listRetailers, request, searchCatalog } from '../src/index.js';

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
      for (const name of ['plan_purchase','find_nearby_stock','get_medication_info','compare_products','collect_catalog_snapshot','pharmacy_retailers','pharmacy_prices','pharmacy_search','pharmacy_stock','pharmacy_product']) {
        assert.ok(tools.some(tool=>tool.name===name),name);
      }
      assert.deepEqual((await client.callTool({name:'pharmacy_retailers',arguments:{}})).structuredContent.retailers,listRetailers());
      assert.ok((await client.callTool({name:'pharmacy_stock',arguments:{sku:'1'}})).isError);
    } finally {await client.close()}
  }
});
