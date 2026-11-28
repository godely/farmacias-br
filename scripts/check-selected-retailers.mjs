// Live acceptance. Supply two test origins. Output contains only network names and counts.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const points = args[0] === '--coordinates';
const origins = points ? args.slice(1) : args;
assert.equal(origins.length, 2, 'Supply two test origins');
function locationArgs(value) {
  if (!points) {
    assert.match(value, /^\d{5}-?\d{3}$/);
    return {flags:['--cep', value], input:{zipcode:value}};
  }
  const parts = value.split(',');
  assert.ok(parts.length === 2 && parts.every(part => part.trim().length), 'Supply latitude,longitude');
  const [latitude, longitude] = parts.map(Number);
  assert.ok(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180, 'Invalid test coordinates');
  return {flags:['--lat',parts[0],'--lon',parts[1]], input:{coordinates:{latitude,longitude}}};
}
const locations = origins.map(locationArgs);
const priceScope = points ? 'verified_for_coordinates' : 'verified_for_cep';
const root = new URL('../bin/', import.meta.url);
const execute = promisify(execFile);
const cli = async args => {
  const result = await execute(process.execPath, [fileURLToPath(new URL('farmacias.js',root)), ...args], {maxBuffer: 16 * 1024 * 1024});
  return JSON.parse(result.stdout);
};
const client = new Client({name:'selection-acceptance',version:'1'});
const call = async (name,args) => {
  const response = await client.callTool({name:'pharmacy_'+name,arguments:args},undefined,{timeout:180000});
  assert.ok(!response.isError,name);
  return response.structuredContent;
};
const codes = ['7899547543766','7896004703398'];
const items = codes.map((gtin,i)=>({gtin,quantity:i===0?2:1}));
try {
  const endpoint=process.env.FARMACIAS_TEST_MCP_URL;
  await client.connect(endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
    new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('server.js',root))]}));
  const {retailers:registry} = await call('retailers',{});
  assert.equal(registry.length,3);
  let count = 0;
  for (const mask of [1,2,4,3,5,6,7]) {
    const selected = registry.filter((_,i)=>mask & (1<<i));
    const retailers = selected.map(chain=>chain.id);
    const location = locations[(count++)%2];
    const scope = ['--retailers',retailers.join(',')];
    for (const surface of ['cli','mcp']) {
      const search = surface==='cli' ? await cli(['search','paracetamol',...scope,'--limit','1']) :
        await call('search',{retailers,query:'paracetamol',limit:1});
      assert.deepEqual(search.results.map(x=>x.retailerId),retailers);
      assert.ok(search.results.every(x=>x.status==='matches' && x.products.length));
      const prices = surface==='cli' ? await cli(['prices',codes[0],...scope,...location.flags]) :
        await call('prices',{retailers,query:codes[0],...location.input});
      assert.deepEqual(prices.checkedRetailers.map(x=>x.retailer).sort(),selected.map(x=>x.retailer).sort());
      assert.ok(prices.verifiedOffers.length+prices.onlineOffers.length>0);
      assert.ok(prices.verifiedOffers.every(offer=>offer.priceScope===priceScope && offer.gtin===codes[0]));
      assert.ok(prices.onlineOffers.every(offer=>!String(offer.priceScope).startsWith('verified_for_')));
      for (const chain of prices.checkedRetailers) {
        assert.equal(prices.verifiedOffers.some(offer=>offer.retailer===chain.retailer), chain.status==='verified');
      }
      const basket = surface==='cli' ? await cli(['baskets',codes[0]+':2',codes[1],...scope,...location.flags]) :
        await call('baskets',{retailers,items,...location.input});
      assert.deepEqual(basket.results.map(x=>x.retailerId),retailers);
      for (const line of basket.results) {
        assert.notEqual(line.status,'source_failed');
        if (line.retailerId==='drogasil') {
          assert.ok(line.plan?.coverage.checkedStores>0,'Exact generics must reach branch inventory');
          assert.deepEqual(line.plan.tables.map(t=>t.quantity),[2,1]);
        } else if (line.status==='fulfillable') {
          assert.equal(line.priceScope,priceScope);
          assert.deepEqual(line.items.map(x=>x.requestedQuantity),[2,1]);
        } else if (line.status==='unresolved_items') {
          assert.ok(line.pending.length && line.pending.every(p=>p.status!=='source_failed'));
        }
      }
      assert.ok(basket.rankedProductSubtotals.every(x=>basket.results.some(r=>
        r.retailerId===x.retailerId && r.status==='fulfillable' && r.priceScope===priceScope)));
      console.log(surface,retailers.join('+'),'search, prices and basket passed;',prices.verifiedOffers.length,'local prices');
    }
  }
} finally { await client.close(); }
