import assert from 'node:assert/strict';
import test from 'node:test';
import {compactPartnerAlternatives,planSelectedBaskets as runPlan,purchaseSchema} from '../src/named-baskets.js';

const planSelectedBaskets = (args, deps) => runPlan(args, {clarify:async () => [], ...deps});
import {planArgs} from '../bin/plan-args.js';

const chains=['drogasil','paguemenos','drogariasaopaulo'];
const origin={latitude:-13,longitude:-44};
const items=[{query:'Marca A',includeGenerics:false,quantity:2},{query:'Ingrediente B',genericOnly:true}];

test('a zero-stock chain cannot trigger wider searches when another chain offers pickup or lacks inventory', async () => {
  const zero={checkedStores:30,radiusKm:4,stockUnknown:false,allZero:true,canExpand:true};
  for (const status of ['fulfillable','pickup_not_offered','source_failed']) {
    for (const expandSearch of [false,true]) {
      const calls=[];
      const result=await planSelectedBaskets({retailers:['drogasil','paguemenos'],origin,items:[items[0]],expandSearch},{
        plan:async(id,lines,opts)=>{
          calls.push([id,Boolean(opts.expandSearch)]);
          return id==='drogasil'?{status:'unfilled',coverage:zero}:{status};
        },
      });
      assert.deepEqual(calls,[['drogasil',false],['paguemenos',false]]);
      assert.equal(result.coverage.canExpand,false);
      assert.equal(result.coverage.allZero,false);
      assert.equal(result.results[0].coverage.canExpand,false);
      assert.equal(result.results[0].coverage.checkedStores,30);
      assert.equal(result.results[1].status,status);
    }
  }
  const single=await planSelectedBaskets({retailers:['drogasil'],origin,items:[items[0]]},{
    plan:async()=>({status:'unfilled',coverage:zero})});
  assert.deepEqual(single.coverage,zero);
});

test('confirmed zeros across two directories expand only the chain that has farther branches', async () => {
  const retailers = ['paguemenos','drogariasaopaulo'];
  const calls = [];
  const plan = async (id, lines, opts) => {
    calls.push([id, Boolean(opts.expandSearch)]);
    return {status:'unfilled', coverage:{allZero:true, stockUnknown:false, checkedStores:3,
      radiusKm:id === 'paguemenos' ? 4 : 3, canExpand:id === 'paguemenos' && !opts.expandSearch}};
  };
  const args = {retailers, origin, items:[items[0]]};
  const initial = await planSelectedBaskets(args,{plan,clarify:async()=>[]});
  assert.equal(initial.coverage.checkedStores,6);
  assert.equal(initial.coverage.radiusKm,3);
  assert.equal(initial.coverage.canExpand,true);
  assert.deepEqual(calls,retailers.map(id=>[id,false]));
  calls.length = 0;
  const wider = await planSelectedBaskets({...args,expandSearch:true},{plan,clarify:async()=>[]});
  assert.deepEqual(calls,[['paguemenos',false],['drogariasaopaulo',false],['paguemenos',true]]);
  assert.equal(wider.coverage.canExpand,false);
});

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
  for (const lines of [[{query:'123'}], [{query:'med',selectedSku:'123'}]]) {
    const res = await planSelectedBaskets(purchaseSchema.parse({origin,retailers,items:lines}),{plan:assert.fail});
    assert.equal(res.status,'requires_retailer');
  }
  assert.equal(purchaseSchema.safeParse({origin,retailers,items:[{query:'med',selectedSkus:{drogasil:'1'}}]}).success,false);
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
  assert.equal(await planSelectedBaskets(purchaseSchema.parse({origin,retailer:'drogasil',items:[{query:'9'}]}),{
    plan:async(id)=>{assert.equal(id,'drogasil');return native;}}),native);
  assert.equal(purchaseSchema.safeParse({...args,store:'nearest',expandSearch:true}).success,false);
});

test('an unnamed chain searches all three; selecting or changing scope survives a pack clarification', async () => {
  const seen=[];
  const dependencies={resolve:async()=>({kind:'ingredient'}),plan:async(id,lines)=>{
    seen.push([id,lines[0].query]); return {status:'complete'};
  }};
  const scenarios=[
    [{},'ibuprofeno',chains],
    [{},'ibuprofeno 600 mg 20 comprimidos',chains],
    [{retailer:'paguemenos'},'ibuprofeno 600 mg 20 comprimidos',['paguemenos']],
    [{retailers:['drogasil','drogariasaopaulo']},'ibuprofeno 600 mg 20 comprimidos',['drogasil','drogariasaopaulo']],
    [{},'ibuprofeno 600 mg 20 comprimidos',chains],
  ];
  for (const [scope,query,expected] of scenarios) {
    seen.length=0;
    const r=await planSelectedBaskets(purchaseSchema.parse({...scope,origin,items:[{query}]}),dependencies);
    assert.deepEqual(seen,expected.map(id=>[id,query]));
    if (!scope.retailer) assert.deepEqual(r.checkedRetailers,expected);
  }
});


test('partner checkout at the fixed directory branch survives MCP compaction and cannot substitute a farther store', async () => {
  const groups = [['paguemenos','paguemenos00001_abcd'],['drogariasaopaulo','drogariaspcentro_2']];
  const providers = Object.fromEntries(groups.map(([id,point])=>[id,{
    search:async query => query === 'Meu produto' ? [{sku:id === 'paguemenos' ? '8' : '9'}] : [],
    product:async sku => [{sku,sellerId:'1',name:'Meu produto',currentPrice:6}],
    stores:async () => [{id:'2',distanceKm:3},{id:'1',distanceKm:0.4,storeName:'Centro'}],
    local:async (row, place, quantity) => {
      assert.deepEqual(place,origin);
      return {...row,localStatus:'available',requestedQuantity:quantity,methods:[{channel:'pickup-in-point',pickupPointId:point,...(id==='drogariasaopaulo' && {directoryBranchId:'2'})}]};
    },
  }]));
  const response=await planSelectedBaskets({origin,store:'nearest',retailers:groups.map(([id])=>id),
    items:[{query:'Meu produto',selectedSkus:{paguemenos:'8',drogariasaopaulo:'9'},quantity:2}]},{providers});
  assert.deepEqual(response.completeRetailers,['paguemenos']);
  assert.deepEqual(response.results.map(r=>r.fixedStore.branch.id),['1','1']);
  assert.deepEqual(response.results.map(r=>r.tables[0].choices[0].pickupAtStore),['offered','not_offered']);
  assert.deepEqual(response.results.map(r=>r.tables[0].choices[0].branchQuantity),[null,null]);
  assert.equal(response.results[1].status,'pickup_not_offered');
  assert.deepEqual(response.results[1].pickupPoints,[]);
});


test('when a basket splits across chains, each pickup belongs to the nearest branch of its own chain', async () => {
  const ids=['paguemenos','drogariasaopaulo'];
  const names=['Dimorf em gotas','Descongestionante Nasal Spray Ever Care'];
  const providers = Object.fromEntries(ids.map((id,i) => {
    const prefix=id==='paguemenos' ? n=>'paguemenos0000'+n+'_abcd' : n=>'drogariaspcentro_'+n;
    function quote(offer,quantity) {
      const n=offer.name===names[i] ? 1 : 2;
      return {...offer,localStatus:'available',requestedQuantity:quantity,methods:[
        {channel:'pickup-in-point',pickupPointId:prefix(n),...(id==='drogariasaopaulo' && {directoryBranchId:String(n)}),branch:'Filial '+n,distanceKm:n}]};
    }
    const catalog = names.map((name,index)=>({sku:String(index+1),sellerId:'1',name,currentPrice:11+index}));
    return [id,{
      search:async query=>catalog.filter(row=>row.name===query),
      product:async sku=>catalog.filter(row=>row.sku===sku),
      local:async (row,place,q)=>quote(row,q),
      basket:async lines=>lines.map(({offer,quantity})=>quote(offer,quantity)),
      stores:async()=>[{id:'1',storeName:'Perto',distanceKm:1},{id:'2',storeName:'Longe',distanceKm:2}],
    }];
  }));
  const items=names.map((query,i)=>({query,quantity:1,selectedSkus:Object.fromEntries(ids.map(id=>[id,String(i+1)]))}));
  const result=await planSelectedBaskets({origin,retailers:ids,store:'nearest',items},{providers});
  assert.deepEqual(result.completeRetailers,[]);
  const [itinerary]=result.crossRetailerPlans.plans;
  assert.equal(itinerary.stopCount,2); assert.equal(itinerary.totalBRL,23);
  assert.deepEqual(itinerary.stops.map(s=>[s.retailerId,s.id,s.pickups[0].name]).sort(),
    [['paguemenos','paguemenos00001_abcd',names[0]],['drogariasaopaulo','drogariaspcentro_1',names[1]]].sort());
});

test('shared pickup addresses retain each offer and its individual fee', () => {
  const base={localStatus:'available',requestedQuantity:1};
  const point={channel:'pickup-in-point',pickupPointId:'one',distanceKm:0.8,address:{street:'Centro'}};
  const products=[{...base,sku:'1',pickupVerification:{status:'incomplete',unknownPoints:1},closestQuotedPickup:point,methods:[{...point,feeBRL:2}]},
    {...base,sku:'2',methods:[{...point,feeBRL:0},{channel:'delivery',feeBRL:4}]}];
  const row=compactPartnerAlternatives({planningScope:'one_pack_alternatives',products,tables:[{choices:products}]});
  assert.equal(row.pickupPoints.length,1);
  assert.equal(row.pickupPoints[0].distanceKm,0.8);
  const [first,second]=row.tables[0].choices;
  assert.equal(first.pickupVerification.status,'incomplete');
  assert.equal(first.closestPickupPointId,'one'); assert.equal(second.closestPickupPointId,null);
  assert.equal(first.methods[0].feeBRL,2); assert.equal(second.methods[0].feeBRL,0);
  assert.equal(second.methods[1].channel,'delivery'); assert.equal(first.branchQuantity,null);
});
