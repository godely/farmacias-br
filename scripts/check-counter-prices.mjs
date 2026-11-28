// Opt-in live replay through each standalone executable and the Farmácias BR MCP.
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const origins = process.argv.slice(2);
if (origins.length !== 2 || origins.some(s => !/^\d{5}-?\d{3}$/.test(s))) throw Error('Supply two test CEPs.');
const query = 'paracetamol 750 mg 20 comprimidos';
const root = fileURLToPath(new URL('../', import.meta.url));
const client = new Client({name:'counter-prices-check',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[root+'bin/server.js']}));

try {
  for (const [index,retailer] of ['drogasil','paguemenos','drogariasaopaulo'].entries()) {
    const zipcode = origins[index % 2];
    const {stdout} = await promisify(execFile)(root+'node_modules/.bin/'+retailer,['plan',query,'--cep',zipcode,'--json']);
    const response = await client.callTool({name:'plan_purchase', arguments:{retailer,items:[{query}],origin:{zipcode}}}, undefined, {timeout:120000});
    assert.ok(!response.isError);
    assert.ok(response.structuredContent.priceGuidance);
    for (const [surface,data] of [['cli',JSON.parse(stdout)],['mcp',response.structuredContent]]) {
      assert.equal(data.tables.length,1);
      const table=data.tables[0];
      if (retailer==='drogasil') {
        assert.equal(table.matchBasis,'direct_requested_pack');
        assert.equal(data.coverage.canExpand,false);
        const available=table.rows.filter(r=>r.store?.quantity>=1 && Number.isFinite(r.referencePriceBRL));
        const best=available.find(r=>r.option===table.lowestPricedStockedOption);
        assert.ok(best);
        assert.equal(best.referencePriceBRL,Math.min(...available.map(r=>r.referencePriceBRL)));
      } else {
        assert.equal(data.planningScope,'one_pack_alternatives');
        assert.ok(data.products.every(p=>p.branchQuantity===null));
        const offered=data.products.filter(p=>p.localStatus==='available' && Number.isFinite(p.currentPrice) &&
          p.methods.some(m=>m.channel==='pickup-in-point' && m.pickupPointId));
        if (offered.length) assert.equal(data.lowestPricedPickup.currentPrice,Math.min(...offered.map(p=>p.currentPrice)));
        else assert.equal(data.lowestPricedPickup,null);
      }
      console.log('PASS',surface,retailer);
    }
  }
} finally { await client.close(); }
