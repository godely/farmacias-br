// Live MCP acceptance. Supply two test CEPs explicitly; output omits both and all addresses.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const origins = process.argv.slice(2);
assert.ok(origins.length === 2 && origins.every(o => /^\d{5}-?\d{3}$/.test(o)),
  'Usage: node scripts/check-retailer-workflows.mjs CEP1 CEP2');
const directory = await mkdtemp(join(tmpdir(), 'farmacias-audit-'));
const client = new Client({name:'retailer-workflows',version:'1'});
const passed = [], failed = [];
async function call(name,args) {
  const response = await client.callTool({name:'pharmacy_'+name,arguments:args}, undefined, {timeout:180000});
  assert.ok(!response.isError, name+' returned an MCP error');
  return response.structuredContent;
}
async function check(retailer, name, run) {
  try {
    const detail = await run();
    passed.push([retailer,name]);
    console.log(JSON.stringify({retailer,check:name,result:'pass',detail}));
  } catch (error) {
    failed.push([retailer,name]);
    console.error(JSON.stringify({retailer,check:name,result:'fail',detail:error.message.split('\n')[0]}));
  }
}
const genericAnchor={paguemenos:'22773',drogariasaopaulo:'3530'};
const branded = {paguemenos:'3179',drogariasaopaulo:'19119'};
const sample = {paguemenos:'1633706', drogariasaopaulo:'883646'};
try {
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))],
    env:{FARMACIAS_SENTRY_DSN:'',DROGASIL_SNAPSHOT_DB:join(directory,'runs.sqlite3')}}));
  const registry = (await call('retailers',{})).retailers;
  assert.deepEqual(registry.map(r=>r.id),['drogasil','paguemenos','drogariasaopaulo']);
  for (const [retailer,sku] of Object.entries(sample)) {
    const args={retailer};
    let gtin;
    await check(retailer,'search and pagination',async()=>{
      const pages=[];
      for (const page of [1,2]) {
        const [group]=(await call('search',{...args,query:'loratadina',limit:1,page})).results;
        assert.equal(group.status,'matches');
        assert.ok(group.products.every(p=>p.retailerId===retailer && p.sku && p.name));
        pages.push(group.products[0].sku);
      }
      assert.notEqual(...pages);
    });
    await check(retailer,'suggestions and rejection',async()=>{
      const first=await call('suggest',{...args,query:'lorata'});
      assert.equal(first.confirmation?.question,'Você quis dizer loratadina?');
      const rest=await call('suggest',first.confirmation.onNo);
      assert.equal(rest.retailerId,retailer);
      assert.ok(rest.suggestions.every(s=>s.toLowerCase()!=='loratadina'));
      return rest.status;
    });
    await check(retailer,'SKU and catalog offer',async()=>{
      const d=await call('product',{...args,sku});
      assert.equal(d.status,'matches');
      assert.ok(d.products.every(row=>row.sku===sku && row.retailerId===retailer && row.priceScope==='anonymous_online' &&
        (row.currentPrice===null || Number.isFinite(row.currentPrice)) && row.currency==='BRL'));
      gtin=d.products[0].gtin;
      assert.ok(gtin);
    });
    await check(retailer,'exact barcode and ordered SKU batch',async()=>{
      const d=await call('product',{...args,gtin});
      assert.equal(d.status,'matches');
      assert.ok(d.products.some(p=>p.sku===sku));
      assert.ok(d.products.every(p=>p.gtin===gtin));
      const batch=await call('product',{...args,skus:[sku,'999999999',sku]});
      assert.deepEqual(batch.results.map(x=>x.status),['matches','unknown_sku','matches']);
      assert.deepEqual(batch.results[0],batch.results[2]);
    });
    await check(retailer,'catalog medication facts without CEP',async()=>{
      const data=await call('info',{...args,queries:[sku,'loratadina'],limit:2});
      assert.equal(data.retailerId,retailer);
      assert.ok(data.results.every(r=>r.status==='matches' && r.products.every(p=>p.source && p.name)));
      assert.equal(data.results[0].products[0].sku,sku);
      assert.ok(data.results[0].products[0].strengths.length);
      assert.ok(!/"(?:currentPrice|branches|inStock|listPrice)":/.test(JSON.stringify(data)));
      return data.results.map(r=>r.products.length);
    });
    for(const [index,zipcode] of origins.entries()) {
      await check(retailer,'stock origin '+(index+1),async()=>{
        const quantity=index+1;
        const d=await call('stock',{...args,sku,zipcode,quantity});
        assert.equal(d.status,'checked');
        assert.ok(d.offers.length);
        for (const offer of d.offers) {
          assert.equal(offer.sku,sku);
          assert.equal(offer.requestedQuantity,quantity);
          if(offer.localStatus==='available') {
            assert.equal(offer.priceScope,'verified_for_cep');
            assert.ok(offer.methods.length && offer.methods.every(m=>['delivery','pickup-in-point'].includes(m.channel)));
          } else {
            assert.ok(['unavailable','unverified'].includes(offer.localStatus));
            assert.equal(offer.methods.length,0);
          }
        }
        return d.offers.map(o=>({status:o.localStatus,branches:o.branches?.length,channels:[...new Set(o.methods?.map(m=>m.channel))]}));
      });
    }
    await check(retailer,'coordinate-only and unknown stock SKU',async()=>{
      const directory=await call('stores',{...args,zipcode:origins[0],limit:3});
      const branch=directory.stores.find(b=>Number.isFinite(b.address?.latitude) && Number.isFinite(b.address?.longitude));
      assert.ok(branch,'Directory needs one geolocated branch');
      const {latitude,longitude}=branch.address;
      const geo=await call('stock',{...args,sku,coordinates:{latitude,longitude}});
      assert.equal(geo.status,'checked');
      assert.ok(geo.offers.every(o=>o.localStatus!=='available'||o.priceScope==='verified_for_coordinates'));
      const missing=await call('stock',{...args,sku:'999999999',zipcode:origins[0]});
      assert.equal(missing.status,'unknown_sku');
      assert.deepEqual(missing.offers,[]);
    });
    await check(retailer,'location-aware comparison',async()=>{
      const result=await call('compare',{...args,query:sku,includeGenerics:false,zipcode:origins[1]});
      assert.equal(result.stockEvidence,'fulfillment_quote');
      assert.ok(result.products.length && result.products.every(x=>x.sku===sku && x.branchQuantity===null && x.localStatus!=='lookup_failed'));
      return result.products.map(p=>p.localStatus);
    });
    await check(retailer,'single-call selected basket',async()=>{
      const response=await client.callTool({name:'plan_purchase',arguments:{retailer,items:[{query:sku,selectedSku:sku},{query:branded[retailer],selectedSku:branded[retailer]}],origin:{zipcode:origins[0]}}});
      const d=response.structuredContent;
      assert.equal(d.retailerId,retailer);
      assert.equal(d.planningScope,'whole_basket_fulfillment');
      assert.deepEqual(d.items.map(q=>q.sku),[sku,branded[retailer]]);
      return d.status;
    });
    await check(retailer,'compare local SKU across active catalogs',async()=>{
      const d=await call('prices',{...args,query:sku,zipcode:origins[1]});
      assert.equal(d.status,'matched');
      assert.equal(d.reference.gtin,gtin);
      assert.equal(new Set(d.checkedRetailers.map(r=>r.retailer)).size,3);
      assert.ok(d.checkedRetailers.every(r=>r.status!=='source_failed'));
      assert.ok(!(d.issues??[]).length);
      const prices=d.verifiedOffers.map(p=>p.currentPrice);
      assert.ok(d.verifiedOffers.every(p=>p.gtin===gtin && p.priceScope==='verified_for_cep' && p.fulfillment.length));
      assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
      assert.ok(d.onlineOffers.every(p=>p.gtin===gtin && (p.priceScope!=='verified_for_cep' || p.currentPrice==null)));
      return {local:d.verifiedOffers.length,online:d.onlineOffers.length};
    });
    await check(retailer,'verified generics and brand-only choice',async()=>{
      const query=genericAnchor[retailer];
      const justBrand=await call('compare',{...args,query,includeGenerics:false});
      assert.ok(justBrand.products.length && justBrand.products.every(p=>p.sku===query && p.role==='requested'));
      const d=await call('compare',{...args,query,includeGenerics:true});
      assert.equal(d.status,'matches');
      assert.equal(d.products[0].sku,query);
      const generics=d.products.filter(p=>p.role==='generic');
      assert.ok(generics.length,'expected at least one verified equivalent of this common pack');
      assert.ok(generics.every(p=>p.retailerId===retailer && p.type==='Genérico' && p.gtin===p.equivalenceEvidence.gtin));
      const prices=generics.map(p=>p.currentPrice??Infinity);
      assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
      return {verifiedGenericOffers:generics.length};
    });
    await check(retailer,'incomplete reference presentation',async()=>{
      const d=await call('compare',{...args,query:branded[retailer],includeGenerics:true});
      assert.equal(d.status,'incomplete_presentation');
      assert.ok(d.missingFields.includes('dosage_form') && d.products.every(p=>p.role==='requested'));
    });
    if (retailer==='paguemenos') await check(retailer,'promotional bundle',async()=>{
      const d=await call('compare',{...args,query:'17003',includeGenerics:true});
      assert.equal(d.status,'incomplete_presentation');
      assert.ok(d.missingFields.includes('verified_reference_pack') && d.products.every(p=>p.role==='requested'));
    });
    await check(retailer,'two-product basket',async()=>{
      const d=await call('basket',{...args,zipcode:origins[1],items:[{sku,quantity:2},{sku:branded[retailer]}]});
      assert.equal(d.items.length,2);
      assert.deepEqual(d.items.map(p=>[p.sku,p.requestedQuantity]),[[sku,2],[branded[retailer],1]]);
      assert.ok(['fulfillable','partial','unavailable','unconfirmed'].includes(d.status));
        if(d.status==='fulfillable') assert.ok(d.items.every(i=>i.priceScope==='verified_for_cep'));
        for(const point of d.commonPickupPoints) assert.ok(d.items.every(i=>i.methods.some(m=>m.pickupPointId===point.id)));
      return {status:d.status,commonPickupPoints:d.commonPickupPoints.length,total:d.estimatedProductTotalBRL};
    });
    await check(retailer,'collect and page a snapshot',async()=>{
      const start=await call('snapshot',{...args,queries:['loratadina'],maxItems:2});
      let first;
      for(let i=0;i<60;i++) {
        first=await call('read_snapshot',{runId:start.runId,limit:1});
        if(first.state!=='running') break;
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      assert.equal(first.state,'succeeded');
      assert.equal(first.count,2);
      const second=await call('read_snapshot',{runId:start.runId,offset:first.nextOffset,limit:1});
      assert.equal(second.nextOffset,null);
      assert.notEqual(first.records[0].sku,second.records[0].sku);
      assert.ok([first,second].every(page=>page.records[0].retailerId===retailer &&
        page.records[0].offers.every(o=>o.sku===page.records[0].sku && o.priceScope==='anonymous_online')));
    });
  }
} finally {
  await client.close();
  await rm(directory,{recursive:true,force:true});
}
console.log(JSON.stringify({passed:passed.length,failed}));
if (failed.length) process.exitCode=1;
