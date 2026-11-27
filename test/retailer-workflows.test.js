import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogInfo, medicationCard } from '../src/catalog-workflows.js';
import { getProduct, schemas } from '../src/index.js';
import { retailerBasket, retailerComparison } from '../src/retailer-shopping.js';

test('bulk preserves missing, failed and repeated SKUs and barcode lookups validate returned identifiers', async()=>{
  const calls=[];
  const source={product:async sku=>{
    calls.push(sku);
    if (sku==='3') throw Error('outage');
    return sku==='1' ? [{sku,name:'A'}] : [];
  },byGtin:async()=>[{name:'right',gtin:'7891058002602'},{name:'wrong',gtin:'7899547543766'}]};
  const retailer='drogariasaopaulo', sources={[retailer]:source};
  const batch=await getProduct({retailer,skus:['2','3','1','1']},sources);
  assert.deepEqual(calls,['2','3','1']);
  assert.deepEqual(batch.results.map(x=>x.status),['unknown_sku','source_failed','matches','matches']);
  assert.deepEqual((await getProduct({retailer,gtin:'7891058002602'},sources)).products.map(p=>p.name),['right']);
  for (const args of [{},{gtin:'7891058002609'},{sku:'1',skus:['2']}]) assert.equal(schemas.product.safeParse({retailer,...args}).success,false);
});

test('fact-only paths preserve concentration, pack and explicit classification, independently of price or stock',async()=>{
  const row={sku:'1',name:'Exemplo 10 mg/mL gotas 20 mL', facts:{'Tipo de Medicamento':['Genéricos'],'Prescrição Médica':['Sob prescrição']}};
  const source={facts:async q=>q==='bad'?Promise.reject(Error('offline')):[row],
    local:assert.fail,search:assert.fail,product:assert.fail};
  const d=await catalogInfo({retailer:'drogariasaopaulo',queries:['1','bad'],page:1,limit:3},source);
  assert.deepEqual(d.results.map(r=>r.status),['matches','source_failed']);
  const card=d.results[0].products[0];
  assert.deepEqual(card.strengths,['10 mg/mL']); assert.deepEqual(card.packs,['20 mL']);
  assert.deepEqual(card.prescriptionLabel,['Sob prescrição']); assert.deepEqual(card.retentionLabel,[]);
  assert.equal(card.type,'Genérico');assert.deepEqual(card.routes,[]);
  assert.equal(medicationCard({name:'Exemplo',facts:{Generico:['Não']}}).type,'Não informado');
});

const gtin='7899547543766', other='7891058002602';
const name='Marca 10mg 20 comprimidos';
test('retailer equivalents retain only brand and verified generics of the same pack, priced by the chosen chain',async()=>{
  const a={sku:'1',gtin,name,currentPrice:13}, local={sku:'2',gtin:other,name:'Genérico 10mg 20 comprimidos',currentPrice:5};
  const source={product:async()=>[a],byGtin:async()=>[local,{...local,sku:'3',name:'Genérico 10mg 10 comprimidos'}]};
  const reference={byGtin:async()=>[{name,sku:'90',eanCode:gtin}],compare:async()=>({status:'matches',products:[
    {name:'Genérico 10mg 20 comprimidos',sku:'99',eanCode:other}]})};
  const args={retailer:'paguemenos',query:'1',includeGenerics:true};
  const d=await retailerComparison(args,source,reference);
  assert.deepEqual(d.products.map(r=>[r.sku,r.role,r.currentPrice]),[['1','requested',13],['2','generic',5]]);
  assert.deepEqual(d.products[1].equivalenceEvidence,{source:'drogasil',referenceSku:'99',gtin:other});
  assert.equal((await retailerComparison(args,source,{...reference,byGtin:async()=>[]})).status,'incomplete_presentation');
  assert.equal((await retailerComparison(args,{...source,byGtin:async()=>{throw Error('offline')}},reference)).status,'partial');
  assert.equal((await retailerComparison({...args,query:'Marca'},{search:async()=>[a,local]},reference)).status,'choose_reference');
  assert.equal((await retailerComparison({...args,includeGenerics:false},source,{})).products.length,1);
});

test('only jointly quoted items and identical pickup IDs yield a complete basket and common pickup point',async()=>{
  const args={retailer:'paguemenos',zipcode:'01001000',items:[{sku:'1',quantity:2},{sku:'2',quantity:1}]};
  const product=async sku=>[{sku,sellerId:'A',name:'Product'}];
  const method=id=>({channel:'pickup-in-point',pickupPointId:id,branch:'branch '+id});
  const lines=ids=>ids.map((id,i)=>({sku:String(i+1),name:'Product',localStatus:'available',currentPrice:1.25,
    requestedQuantity:i===0?2:1,methods:[method(id),method('shared')]}));
  const complete=await retailerBasket(args,{product,basket:async selected=>{assert.equal(selected.length,2);return lines(['1','2']);}});
  assert.equal(complete.status,'fulfillable'); assert.deepEqual(complete.commonPickupPoints.map(p=>p.id),['shared']);
  assert.equal(complete.estimatedProductTotalBRL,3.75);
  const partial=await retailerBasket(args,{product,basket:async()=>[lines(['1'])[0],{name:'X',localStatus:'unverified',methods:[]}]});
  assert.equal(partial.status,'partial');assert.equal(partial.estimatedProductTotalBRL,null);assert.deepEqual(partial.commonPickupPoints,[]);
  const pending=await retailerBasket(args,{product:async sku=>[...await product(sku),{sku,sellerId:'B'}],basket:assert.fail});
  assert.equal(pending.pending[0].status,'choose_seller');

});

test('a partner snapshot saves all sellers per SKU, deduplicates overlapping queries and preserves a partial failed run',async t=>{
  const {catalogSnapshot}=await import('../src/catalog-workflows.js');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {join}=await import('node:path');
  const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(join(tmpdir(),'retailer-snapshot-test-'));
  const prior=process.env.DROGASIL_SNAPSHOT_DB;
  process.env.DROGASIL_SNAPSHOT_DB=join(dir,'unit.sqlite');
  t.after(async()=>{
    if(prior===undefined) delete process.env.DROGASIL_SNAPSHOT_DB;
    else process.env.DROGASIL_SNAPSHOT_DB=prior;
    await rm(dir,{force:true,recursive:true});
  });
  const source={search:async(q,p)=>{
    if (q==='fail') throw Error('catalog offline');
    return p===1?['seller1','seller2'].map(seller=>({sku:'2',name:'Example',seller})): [];
  }};
  const d=await catalogSnapshot({retailer:'paguemenos',queries:['first','duplicate','fail'],maxItems:4},source,{background:false});
  assert.equal(d.state,'failed');assert.equal(d.count,1);
  assert.equal(d.records[0].searchQuery,'first');
  assert.deepEqual(d.records[0].offers.map(o=>o.seller),['seller1','seller2']);
});
