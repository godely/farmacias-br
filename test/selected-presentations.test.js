import assert from 'node:assert/strict';
import test from 'node:test';
import {comparePresentations, retailerIds} from '../src/index.js';
import {compareDrogasil} from '../src/providers.js';
import {observations} from '../src/monitoring.js';

const name = 'Produto Exemplo 10 mg 20 comprimidos';
const options = {query:name, includeGenerics:true};
const location = {coordinates:{latitude:-12, longitude:-44}};
const pack = {gtin:'7899547543766', name};
const ids = retailerIds;

function fixtures(report) {
  const calls=[];
  const record = async args => {
    calls.push(args);
    return report(args);
  };
  const sources = Object.fromEntries(ids.map((id,i)=>[id, {
    name:id, product:async query=>[{...pack, sku:query}], byGtin:async()=>[{...pack,sku:String(i+10)}],
    compare:record,
  }]));
  return {calls, sources, comparePartner:record};
}

for(let mask=1;mask<=7;mask++) {
  const retailers=ids.filter((_,index)=>mask & (1<<index));
  test('each selected catalog keeps its own verified alternatives: '+retailers.join('+'),async()=>{
    for (const origin of [{},location]) {
      const fixturesForScope=fixtures(({retailer,query,includeGenerics,coordinates})=>{
        assert.equal(query,name);assert.equal(includeGenerics,true);assert.deepEqual(coordinates,origin.coordinates);
        return {retailerId:retailer, status:'matches', products:[
          {name,role:'requested',sku:'a'}, {name:'Exemplo genérico',role:'generic',sku:'b'}]};
      });
      const result=await comparePresentations({...options,retailers,...origin},fixturesForScope);
      assert.deepEqual(fixturesForScope.calls.map(call=>call.retailer),retailers);
      assert.equal(result.status,'checked');
      for(const [i,group] of result.results.entries()){
        const single=await comparePresentations({...options,retailer:retailers[i],...origin},fixturesForScope);
        assert.deepEqual(group,single);
        assert.deepEqual(group.products.map(p=>p.role),['requested','generic']);
      }
      assert.equal(!!result.coverage, !!origin.coordinates);
    }
  });
}

test('outage and ambiguous presentations remain attributable to each retailer',async()=>{
  const f=fixtures(({retailer})=>{
    if(retailer===ids[0]) throw Error('upstream');
    if(retailer===ids[1]) return {status:'choose_reference',candidates:[{name:'XR'},{name:'convencional'}]};
    return {status:'matches',products:[{name}]};
  });
  const result=await comparePresentations(options,f);
  assert.equal(result.status,'partial');
  assert.deepEqual(result.results.map(r=>r.status),['source_failed','choose_reference','matches']);
  assert.deepEqual(result.results[2].products,[{name}]);
  const recorded=observations('pharmacy_compare',options,result);
  assert.equal(recorded.length,3);
  assert.equal(recorded[0].outcome,'upstream_failure');
  assert.ok(!JSON.stringify(recorded).includes(name));
});

test('translate a known retailer code only through the verified barcode and physical pack',async()=>{
  const f=fixtures(({query})=>({status:'matches',products:[{sku:query}]}));
  const missing=await comparePresentations({...options,query:'42',retailers:ids},f);
  assert.equal(missing.status,'requires_retailer');
  assert.equal(f.calls.length,0);
  f.sources[ids[2]].byGtin=async()=>[{...pack,name:'Produto Exemplo 10 mg 40 comprimidos',sku:'42'}];
  const result=await comparePresentations({...options,query:'42',retailer:ids[0],retailers:ids},f);
  assert.deepEqual(f.calls.map(c=>[c.retailer,c.query]), [[ids[0],'42'],[ids[1],'11']]);
  assert.deepEqual(result.results.map(r=>r.status),['matches','matches','presentation_unconfirmed']);
  const ambiguous=await comparePresentations({...options,query:pack.gtin,retailers:ids},f);
  assert.ok(ambiguous.results.every(r=>r.status==='presentation_unconfirmed'));
});

test('restrict numbered branches to one directory and compare fixed branches only with known distances',async()=>{
  const f=fixtures(({retailer,store})=>{
    assert.equal(store,'nearest');
    return {status:'matches',fixedStore:{status:'identified',branch:{id:retailer,distanceKm:retailer===ids[0]?2:1}},
      products:[],coverage:{checkedStores:1,radiusKm:1,stockUnknown:false,allZero:true,canExpand:false}};
  });
  const args={...options,...location,store:'nearest',retailers:ids};
  const result=await comparePresentations(args,f);
  assert.deepEqual(result.nearestAmongSelected.branches.map(b=>b.retailerId),ids.slice(1));
  assert.equal(result.coverage.canExpand,false);
  f.sources[ids[0]].compare=async()=>({status:'choose_reference',products:[]});
  assert.equal((await comparePresentations(args,f)).nearestAmongSelected.status,'unconfirmed');
  assert.throws(()=>comparePresentations({...args,store:'7'},f));
});

test('widen only after every selected initial check confirmed zero',async()=>{
  let missing=true;
  const f=fixtures(({expandSearch,retailer})=>{
    if(missing && retailer===ids[1]) return {status:'unknown_sku'};
    return {status:expandSearch?'matches':'no_stock',coverage:{checkedStores:3,radiusKm:2,stockUnknown:false,allZero:true,canExpand:true},
      ...(expandSearch && {expandedSearch:{stores:Array.from({length:8},(_,i)=>({
        id:String(i),distanceKm:2*i+(retailer===ids[0]?1:0.5),phone:'example'})),radiusKm:25}})};
  });
  const args={...options,...location,retailers:ids.slice(0,2),expandSearch:true};
  let result=await comparePresentations(args,f);
  assert.ok(!result.coverage.canExpand && !f.calls.some(c=>c.expandSearch));
  missing=false;f.calls.length=0;
  result=await comparePresentations(args,f);
  assert.deepEqual(f.calls.map(c=>c.expandSearch),[false,false,true,true]);
  assert.equal(result.coverage.canExpand,false);
  assert.equal(result.expandedSearch.stores.length,10);
  assert.deepEqual(result.expandedSearch.stores.map(s=>s.distanceKm),[0.5,1,2.5,3,4.5,5,6.5,7,8.5,9]);
  assert.equal(result.expandedSearch.stores[0].retailerId,ids[1]);
  assert.equal(result.expandedSearch.stores[0].phone,'example');
});

test('Drogasil fixed-branch zero, unknown and reported stock keep their separate meanings',async()=>{
  const branch = {id:7,businessName:'Centro',distanceKMFromSearch:'0.5',address:{addressNumber:10}};
  const query = '42';
  const result = await compareDrogasil({query,store:'nearest',includeGenerics:true,...location},async (term,args)=>{
    assert.equal(term,query);assert.deepEqual(args.origin,location.coordinates);
    return {status:'matches',products:[
      {name,sku:42,price:7,stockStatus:'out_of_stock',stores:[{...branch,quantity:0}]},
      {name:'Alternativa Genérico',sku:43,price:5,stockStatus:'in_stock',stores:[{...branch,quantity:3}]},
      {name:'Outra Genérico',sku:44,price:null,stockStatus:'unknown',stores:[{...branch,quantity:null}]},
    ]};
  });
  assert.equal(result.fixedStore.branch.id,'7');
  assert.equal(result.fixedStore.branch.distanceKm,0.5);
  assert.deepEqual(result.products.map(p=>p.branchQuantity),[0,3,null]);
  assert.deepEqual(result.products.map(p=>p.role),['requested','generic','generic']);
  assert.ok(result.products.every(p=>p.priceScope==='catalog_reference'));
});
