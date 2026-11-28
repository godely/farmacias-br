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
  assert.deepEqual(p.stops.map(s=>[s.retailerId,s.pickups[0].item]),ids.map((id,i)=>[id,i]));
});

test('one-stop price and two-chain savings use properly quoted products',async()=>{
  const r=await report(items.slice(0,2),{drogasil:lines=>drug({A:5,B:8},lines),
    paguemenos:lines=>partner({A:[7,'one'],B:[4,'one']},lines)},ids.slice(0,2));
  assert.deepEqual(r.crossRetailerPlans.plans.map(p=>[p.stopCount,p.totalBRL]),[[1,11],[2,9]]);
  assert.deepEqual(r.crossRetailerPlans.comparison,{savingsBRL:2,extraStops:1});
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
