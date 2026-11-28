import assert from 'node:assert/strict';
import test from 'node:test';
import {planSelectedBaskets,purchaseSchema} from '../src/named-baskets.js';
import {planArgs} from '../bin/plan-args.js';

const chains=['drogasil','paguemenos','drogariasaopaulo'];
const origin={latitude:-13,longitude:-44};
const items=[{query:'Marca A',includeGenerics:false,quantity:2},{query:'Ingrediente B',genericOnly:true}];

for(let mask=1;mask<8;mask++) {
  const retailers=chains.filter((_,i)=>mask&(1<<i));
  test('a single named basket preserves the selected chains and each full order: '+retailers.join(', '),async()=>{
    const seen=[];
    const args=purchaseSchema.parse({origin,items,retailers,store:'nearest'});
    const result=await planSelectedBaskets(args,{resolve:assert.fail,plan:async(id,lines,opts)=>{
      seen.push(id);
      assert.deepEqual(lines,items);
      assert.deepEqual(opts.origin,origin);
      assert.equal(opts.store,'nearest');
      if(id==='paguemenos') return {status:'fulfillable',estimatedProductTotalBRL:12,commonPickupPoints:[]};
      if(id==='drogariasaopaulo') return {status:'partial',plans:[],tables:[{status:'unknown'}]};
      return {status:'complete',plans:[{objective:'fewest_stores'},{objective:'lowest_total'}]};
    }});
    assert.deepEqual(seen,retailers);
    assert.deepEqual(result.results.map(r=>r.retailerId),retailers);
    assert.deepEqual(result.completeRetailers,retailers.filter(id=>id!=='drogariasaopaulo'));
    if(retailers.includes('paguemenos')) assert.deepEqual(result.results.find(r=>r.retailerId==='paguemenos').commonPickupPoints,[]);
  });
}

test('asks once for just the brands needing consent before any chain receives the basket',async()=>{
  const args={origin,retailers:chains,items:[{query:'A'},{query:'B'},{query:'C',includeGenerics:false},{query:'D',selectedSkus:{paguemenos:'10'}}]};
  const resolved=[];
  const data=await planSelectedBaskets(purchaseSchema.parse(args),{plan:assert.fail,resolve:async query=>{
    resolved.push(query);return {kind:query==='B'?'ingredient':'brand',name:query};
  }});
  assert.equal(data.status,'needs_generic_preference');
  assert.deepEqual(data.pendingBrands,[{label:'A',name:'A'},{label:'D',name:'D'}]);
  assert.deepEqual(resolved,['A','B','D']);assert.deepEqual(data.results,[]);
});

test('a local SKU cannot cross chains and one provider failure cannot erase a complete result',async()=>{
  const retailers=['paguemenos','drogariasaopaulo'];
  for(const lines of [[{query:'123'}],[{query:'med',selectedSku:'123'}],
    [{query:'med',selectedSkus:{drogasil:'1'}}]]) assert.equal(purchaseSchema.safeParse({origin,retailers,items:lines}).success,false);
  const args=purchaseSchema.parse({origin,retailers,items:[{query:'123',selectedSkus:{paguemenos:'4',drogariasaopaulo:'7'}}]});
  const result=await planSelectedBaskets(args,{resolve:assert.fail,plan:async(id,[line])=>{
    assert.equal(line.query,id==='paguemenos'?'4':'7');assert.equal(line.selectedSku,line.query);
    if(id==='paguemenos') throw Error('timeout');
    return {status:'complete'};
  }});
  assert.deepEqual(result.results.map(x=>x.status),['source_failed','complete']);
  assert.deepEqual(result.completeRetailers,['drogariasaopaulo']);
});

test('the CLI and legacy single-retailer callers preserve preferences and the native return shape',async()=>{
  const args=purchaseSchema.parse(planArgs(['Produto A','Ingrediente B','--retailers','paguemenos,drogariasaopaulo',
    '--brand-only','A','--quantity','B=3','--sku','A=paguemenos:9','--lat','-13','--lon','-44','--store','nearest']));
  assert.equal(args.items[1].quantity,3);assert.deepEqual(args.items[0].selectedSkus,{paguemenos:'9'});
  assert.equal(args.items[0].includeGenerics,false);assert.deepEqual(args.origin,origin);
  const native={status:'unfilled',tables:[],plans:[]};
  assert.equal(await planSelectedBaskets(purchaseSchema.parse({origin,items:[{query:'9'}]}),{
    plan:async(id)=>{assert.equal(id,'drogasil');return native;}}),native);
  assert.equal(purchaseSchema.safeParse({...args,store:'nearest',expandSearch:true}).success,false);
});
