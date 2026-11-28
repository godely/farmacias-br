import test from 'node:test';
import assert from 'node:assert/strict';
import { storeDirectories, schemas } from '../src/index.js';
import { observations } from '../src/monitoring.js';

const ids = ['drogasil','paguemenos','drogariasaopaulo'];
const coordinates = {latitude:-8,longitude:-34};
const rows = [{id:'1',storeName:'Centro',openingHours:{sunday:null}},{id:'2',storeName:'Norte',distanceKm:null}];
function sources(calls) {
  return Object.fromEntries(ids.map(id => [id, {
    directoryScope:id === 'paguemenos' ? 'near_origin' : 'national',
    directory:async origin => { calls.push([id,origin]); return {status:'checked',scope:'national',order:'straight_line_distance',stores:rows}; },
    stores:async origin => { calls.push([id,origin]); return rows; },
  }]));
}
test('every selection pages just its directories, retains request order, origin, names, and missing distances',async()=>{
  for (let mask=1;mask<8;mask++) {
    const retailers=ids.filter((_,i)=>mask & 1<<i).reverse();
    const calls=[];
    const data=await storeDirectories({retailers,coordinates,page:2,limit:1},sources(calls));
    assert.deepEqual(calls,retailers.map(id=>[id,coordinates]));
    assert.equal(data.status,'checked');
    assert.deepEqual(data.results.map(x=>x.retailerId),retailers);
    for (const r of data.results) {assert.deepEqual(r.stores,[rows[1]]);assert.equal(r.total,2);}
  }
});
test('missing origin, a locator outage and a checked empty directory are distinct and isolated',async()=>{
  const calls=[];
  const providers=sources(calls); providers.drogasil.directory=async()=>({status:'checked',scope:'national',stores:[]});
  providers.drogariasaopaulo.stores=async()=>{throw Error('failure')};
  const response=await storeDirectories({retailers:ids},providers);
  assert.equal(response.status,'partial');
  assert.deepEqual(response.results.map(r=>[r.status,r.total]),[['checked',0],['requires_origin',null],['source_failed',null]]);
  assert.equal(calls.length,0);
  assert.deepEqual(observations('pharmacy_stores',{retailers:ids},response).map(r=>r.outcome),['ok','clarification','upstream_failure']);
});
test('preserves the single-retailer contract and rejects two origins, duplicate chains, or two selectors',async()=>{
  const providers=sources([]);
  const r=await storeDirectories({retailer:'paguemenos',zipcode:'01001000'},providers);
  assert.equal(r.retailerId,'paguemenos');assert.equal(r.total,2);assert.deepEqual(r.stores,rows);
  for (const args of [{retailer:'drogasil',retailers:ids},{retailers:['drogasil','drogasil']},{},
    {retailers:ids,zipcode:'01001000',coordinates}]) assert.equal(schemas.stores.safeParse(args).success,false);
});
