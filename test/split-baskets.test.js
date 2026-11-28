import test from 'node:test';
import assert from 'node:assert/strict';
import {planSelectedBaskets} from '../src/named-baskets.js';

const ids=['drogasil','paguemenos','drogariasaopaulo'];
const items=['A','B','C'].map(query => ({query,brand:query,includeGenerics:false}));
const origin={latitude:-13,longitude:-44};
const drug = (offers, lines) => ({tables:lines.map(({query}) => ({label:query,rows: offers[query] ? [{
  sku:query,name:query,referencePriceBRL:offers[query],store:{id:'1',quantity:2,distanceKm:1}}] : []}))});
const partner = (offers,lines) => {
  const rows=lines.map(line=>offers[line.query]);
  const items=lines.map(({query,quantity=1},i) => {
    const [price,point,channel] = rows[i] ?? [];
    return {name:query,sku:query,requestedQuantity:quantity,currentPrice:price,localStatus:'available',
      methods:[{channel:channel ?? 'pickup-in-point',pickupPointId:point,branch:point,distanceKm:1}]};
  });
  const ids=items.map(p=>p.methods[0].pickupPointId);
  return {tables:lines.map(({query},i)=>({query,status:rows[i]?'matches':'no_match',choices:rows[i]?[items[i]]:[]})),
    ...(rows.every(Boolean) && {items,commonPickupPoints:ids.every(id=>id===ids[0])?[{id:ids[0]}]:[]})};
};
const report=(lines,providers,retailers=ids)=>planSelectedBaskets({origin,items:lines,retailers},
  {resolve:assert.fail,plan:async(id,subset)=>providers[id](subset)});

test('three exclusive brands complete a basket in three stores with one shared origin',async()=>{
  const r=await report(items,{drogasil:lines=>drug({A:10},lines),paguemenos:lines=>partner({B:[5,'b']},lines),
    drogariasaopaulo:lines=>partner({C:[4,'c']},lines)});
  assert.deepEqual(r.completeRetailers,[]);
  const [p]=r.crossRetailerPlans.plans;
  assert.deepEqual([p.objective,p.stopCount,p.totalBRL],['both',3,19]);
  assert.deepEqual(p.stops.map(s=>[s.retailerId,s.pickups[0].item]).sort((a,b)=>a[1]-b[1]),ids.map((id,i)=>[id,i]));
});

test('one-stop price and two-chain savings use properly quoted products',async()=>{
  const r=await report(items.slice(0,2),{drogasil:lines=>drug({A:5,B:8},lines),
    paguemenos:lines=>partner({A:[7,'one'],B:[4,'one']},lines)},ids.slice(0,2));
  assert.deepEqual(r.crossRetailerPlans.plans.map(p=>[p.stopCount,p.totalBRL]),[[1,11],[2,9]]);
  assert.deepEqual(r.crossRetailerPlans.comparison,{savingsBRL:2,extraStops:1,extraKm:null});
});

test('separate pickup points in one chain count as two, even with an unknown price',async()=>{
  const r=await report(items.slice(0,2),{drogasil:lines=>drug({},lines),
    paguemenos:lines=>partner({A:[null,'one'],B:[7,'two']},lines)},ids.slice(0,2));
  assert.deepEqual(r.crossRetailerPlans.plans.map(p=>[p.stopCount,p.totalBRL,p.objective]),[[2,null,'fewest_stores']]);
});

test('delivery, failed lookups and individually quoted repeated lines do not prove joint pickup',async()=>{
  for(const scenario of ['delivery','failure','repeat']){
    const lines=scenario==='repeat' ? [items[0],items[0]] : items.slice(0,2);
    const r=await report(lines,{drogasil:subset=>drug({},subset),paguemenos:subset=>{
      if(scenario==='failure' && subset.length===1) throw Error('offline');
      return partner({A:[5,'one'],B:[3,'two',scenario==='delivery'?'delivery':'pickup-in-point']},subset);
    }}, ids.slice(0,2));
    if(scenario==='failure') assert.ok(r.crossRetailerPlans.lookupFailures.length);
    assert.equal(r.crossRetailerPlans.status,'no_complete_plan_verified');
  }
});

test('repeated packs at a shared partner point require a quote for the sum',async()=>{
  for(const available of [true,false]){
    const asked=[];
    const result=await report([items[0],{...items[0],quantity:2}],{
      drogasil:lines=>drug({},lines),
      paguemenos:lines=>{
        const r=partner({A:[5,'one']},lines);
        for(const p of r.items??[]) p.sellerId='1';
        if(lines[0].selectedSku) {
          asked.push(lines[0].quantity);
          if(!available) r.items[0].localStatus='unavailable';
        }
        return r;
      },
    },ids.slice(0,2));
    assert.deepEqual(asked,[3]);
    const [p]=result.crossRetailerPlans.plans;
    if(available) assert.deepEqual([p.stopCount,p.totalBRL,p.stops[0].pickups.map(i=>i.packs)],[1,15,[1,2]]);
    else assert.equal(p,undefined);
  }
});

test('a farther branch wins when the two-stop round trip is shorter',async()=>{
  const r=await report(items.slice(0,2),{
    drogasil:()=>({branchChoices:[[-0.01,0.011].map((longitude,i)=>({
      sku:'a',name:'A',packs:1,unitPriceBRL:5,
      store:{id:String(i+1),name:i?'along the route':'opposite direction',coordinates:{latitude:0,longitude},
        quantity:1,distanceKm:i?1.22:1.11}})),[]]}),
    paguemenos:lines=>{
      const r=partner({B:[4,'b']},lines);
      for(const p of r.items??[]) for(const m of p.methods){
        m.address={geoCoordinates:[0.012,0]};m.distanceKm=1.33;
      }
      return r;
    },
  },ids.slice(0,2));
  const [plan]=r.crossRetailerPlans.plans;
  assert.equal(plan.stops.find(s=>s.retailerId==='drogasil').name,'along the route');
  assert.ok(plan.roundTripKm>2.65 && plan.roundTripKm<2.68);
  assert.equal(plan.routeExactAmongChosenStops,true);
});

test('the first MCP text block gives the complete trip before bulky retailer details',async()=>{
  const {shoppingReply,toolReply}=await import('../src/server.js');
  const r=await report(items,{drogasil:lines=>drug({A:10},lines),paguemenos:lines=>partner({B:[5,'b']},lines),
    drogariasaopaulo:lines=>partner({C:[4,'c']},lines)});
  const reply=shoppingReply(toolReply('plan_purchase',{},r));
  assert.equal(reply.structuredContent.crossRetailerPlans.plans[0].stopCount,3);
  assert.match(reply.content[0].text,/Cesta completa.*\n.*3 lojas/);
  for(const name of ['Drogasil','Pague Menos','Drogaria São Paulo']) assert.ok(reply.content[0].text.includes(name));
});

for (const retailer of ids.slice(1)) {
  test(retailer+' ranks pickups in named, single-selection and mixed MCP baskets',async()=>{
    const lines=items.slice(0,2);
    const plan=async (id,subset)=>{
      if (id!==retailer) return drug({},subset);
      const joint=subset.length>1;
      return partner({A:[joint?8:4,joint?'shared':'first'],B:[joint?8:4,joint?'shared':'second']},subset);
    };
    const {shoppingReply,toolReply}=await import('../src/server.js');
    for(const scope of [{retailer},{retailers:[retailer]},{retailers:['drogasil',retailer]}]) {
      const args={...scope,origin,items:lines};
      const result=await planSelectedBaskets(args,{plan,resolve:assert.fail});
      const pickup=(result.results?.find(r=>r.retailerId===retailer) ?? result).pickupPlans;
      assert.deepEqual(pickup.plans.map(p=>[p.stopCount,p.totalBRL]),[[1,16],[2,8]]);
      if (result.results) assert.ok(result.completeRetailers.includes(retailer));
      const text=shoppingReply(toolReply('plan_purchase',args,result)).content[0].text;
      assert.match(text,/Cesta completa/);
      assert.match(text,/Economia de/);
    }
  });
}

test('overlapping assortments can fill the same basket with two of the three retailers',async()=>{
  // A is sold by two chains, B by the second, and C by the third.
  // Adding a chain must preserve the already feasible two-stop itinerary.
  for (let mask=1; mask<8; mask++) {
    const selected=ids.filter((_,i)=>mask & (1<<i));
    const called=new Set();
    const result=await planSelectedBaskets({items,origin,retailers:selected},{
      plan:async (id,lines)=>{
        called.add(id);
        if (id === 'drogasil') return drug({A:10},lines);
        return partner(id === 'paguemenos' ? {B:[3,'b']} : {A:[8,'ac'],C:[5,'ac']},lines);
      },resolve:assert.fail,
    });
    assert.deepEqual([...called].sort(),[...selected].sort());
    const solution=result.crossRetailerPlans ?? result.results[0].pickupPlans;
    const full=solution?.plans.find(p=>p.stops.flatMap(s=>s.pickups).length===items.length);
    assert.equal(Boolean(full),selected.includes('paguemenos') && selected.includes('drogariasaopaulo'),selected.join(','));
    if (full) {
      assert.deepEqual([full.stopCount,full.totalBRL],[2,16]);
      assert.deepEqual(full.stops.find(s=>s.retailerId==='drogariasaopaulo').pickups.map(p=>p.item),[0,2]);
    }
  }
});
