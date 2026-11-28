import test from 'node:test';
import assert from 'node:assert/strict';
import {planSelectedBaskets} from '../src/named-baskets.js';
import {shoppingReply, toolReply} from '../src/server.js';

const chains = ['drogasil','paguemenos','drogariasaopaulo'];
const query = 'Patz GTS em gotas, frasco de 30 mL';
const args = {items:[{query,includeGenerics:false}],origin:{latitude:0,longitude:0}};

async function check(scope, resultFor, items = args.items) {
  const params = {...args,...scope,items};
  const calls = [];
  const result = await planSelectedBaskets(params,{
    clarify:async()=>[],
    plan:async id=>{calls.push(id);return resultFor(id);},
  });
  const reply = shoppingReply(toolReply('plan_purchase',params,result));
  return {result, reply, calls};
}

const miss = id => ({status:id==='drogasil'?'unfilled':'choose_products',coverage:{canExpand:false},
  tables:[{query,status:id==='drogasil'?'no_reference':'no_match'}]});

test('a missed pack at each selected retailer ends the lookup without pricing an alternative',async()=>{
  for (const retailer of chains) {
    const {result,reply,calls} = await check({retailer},miss);
    assert.deepEqual(calls,[retailer]);
    assert.deepEqual(result.catalogMisses,[{item:0,retailerId:retailer,name:query,
      reason:retailer==='drogasil'?'no_reference':'no_match',branchStock:'unverified'}]);
    assert.equal(reply.structuredContent.nextAction,'answer_with_catalog_miss');
    assert.equal(reply.structuredContent.priceGuidance,undefined);
    assert.match(reply.content[0].text,/Patz GTS em gotas, frasco de 30 mL/);
    assert.doesNotMatch(reply.content[0].text,/20 mL|R\$|25 km/);
  }
  for (let mask=1;mask<8;mask++) {
    const retailers=chains.filter((_,i)=>mask & (1<<i));
    const {result,reply,calls}=await check({retailers},miss);
    assert.deepEqual(calls,retailers);
    assert.deepEqual(result.results.flatMap(r=>r.catalogMisses.map(m=>m.retailerId)),retailers);
    assert.equal(reply.structuredContent.nextAction,'answer_with_catalog_miss');
    assert.equal(result.coverage.canExpand,false);
    assert.equal(reply.structuredContent.priceGuidance,undefined);
  }
});

test('an exact offer and a failed source keep their own outcomes beside a missed presentation',async()=>{
  const {result,reply}=await check({retailers:chains},id=>{
    if (id==='drogasil') return miss(id);
    if (id==='paguemenos') throw Error('connection failed');
    return {status:'fulfillable',planningScope:'one_pack_alternatives',tables:[{query,status:'fulfillable'}],
      lowestPricedPickup:{name:query,currentPrice:8},products:[{name:query,methods:[],currentPrice:8,localStatus:'available'}]};
  });
  assert.deepEqual(result.results.map(r=>[r.status, r.catalogMisses?.length??0]),
    [['unfilled',1],['source_failed',0],['fulfillable',0]]);
  assert.match(reply.structuredContent.catalogMissGuidance,/Drogasil/);
  assert.doesNotMatch(reply.structuredContent.catalogMissGuidance,/Pague Menos|Drogaria São Paulo/);
  assert.ok(reply.structuredContent.priceGuidance);
  assert.notEqual(reply.structuredContent.nextAction,'answer_with_catalog_miss');
});

test('ambiguous packs, unknown stock, confirmed zero and outages stay distinct from catalog misses',async()=>{
  for (const status of ['choose_reference','no_stock','unverified','catalog_lookup_failed']) {
    const {result,reply}=await check({retailer:chains[0]},()=>({tables:[{status,choices:['a','b']}]}));
    assert.equal(result.catalogMisses,undefined);
    assert.equal(reply.structuredContent.catalogMissGuidance,undefined);
  }
  const {result,reply}=await check({retailer:chains[0]},()=>({tables:[{status:'no_reference'}]}),
    [{query:'7891234567895'}]);
  assert.equal(result.catalogMisses[0].name,'Item 1');
  assert.doesNotMatch(reply.content[0].text,/7891234567895/);
});

test('registered presentation comparisons show independently quoted generics outside the basket',()=>{
  const table={query:'Marca',registeredPresentation:{category:'Similar'},comparisonOptions:[{name:'Genérico'}],
    requestedBrand:{name:'Marca',status:'no_exact_catalog_match'},status:'presentation_comparison'};
  const result=shoppingReply({structuredContent:{retailerId:'paguemenos',tables:[table]}}).structuredContent;
  assert.equal(result.nextAction,'show_presentation_comparisons');
  assert.match(result.registeredComparisonGuidance,/similar prescrito/);
  assert.doesNotMatch(result.registeredComparisonGuidance,/sem estoque/);
});
