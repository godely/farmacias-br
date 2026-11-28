import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {getStock, listRetailers} from '../src/index.js';

for (const retailer of ['paguemenos','drogariasaopaulo']) {
  test(retailer+' returns pickup and dated branch observations independently', async t => {
    const prefix = retailer.toUpperCase()+'_BRANCH_STOCK_';
    const previous = [process.env[prefix+'DB'],process.env[prefix+'MAX_AGE_MINUTES']];
    t.after(() => ['DB','MAX_AGE_MINUTES'].forEach((key,i) => {
      if (previous[i] == null) delete process.env[prefix+key];
      else process.env[prefix+key] = previous[i];
    }));
    delete process.env[prefix+'DB']; delete process.env[prefix+'MAX_AGE_MINUTES'];
    const args = {retailer,sku:'42',zipcode:'01001000',includeAll:true,maxBranches:3};
    const row = {sku:'42',name:'Produto de teste',sellerId:'1'};
    const source = {product:async()=>[row],
      stores:async()=>Array.from({length:4},(_,i)=>({id:String(i+1),storeName:'Loja '+i,distanceKm:i+1})),
      local:async()=>({...row,localStatus:'available',methods:[{channel:'pickup-in-point',pickupPointId:'4'}]})};
    const lookup = extra => getStock({...args,...extra},{[retailer]:source});
    const noFeed = await lookup();
    assert.equal(noFeed.branchInventory.status,'unknown');
    assert.equal(noFeed.offers[0].localStatus,'available');
    const folder = await mkdtemp(join(tmpdir(),'partner-inventory-test-'));
    t.after(()=>rm(folder,{recursive:true,force:true}));
    const database = join(folder,'stock.db'), csv = join(folder,'stock.csv');
    const time = new Date(Date.now()-60000).toISOString();
    const records = [1,2,3,4].map(i=>[retailer,42,i,i===4 ? 2 : 0,time].join(','));
    await writeFile(csv,['retailer,id,store_code,quantity,timestamp',...records].join('\n'));
    const importer = new URL('branch_inventory.py',import.meta.resolve('paguemenos-cli'));
    execFileSync('python3',[fileURLToPath(importer),'import','--database',database,'--retailer',retailer,'--snapshot-at',time,csv]);
    process.env[prefix+'DB'] = database;
    process.env[prefix+'MAX_AGE_MINUTES'] = '10';
    assert.equal(listRetailers().find(r=>r.id===retailer).capabilities.branchInventorySource,'snapshot_configured');
    const stocked = await lookup({expandSearch:true});
    assert.deepEqual(stocked.branchInventory.stores.map(s=>s.quantity),[0,0,0]);
    assert.equal(stocked.branchInventory.coverage.canExpand,false);
    assert.equal(Date.parse(stocked.branchInventory.snapshotAt),Date.parse(time));
    source.local = async()=>({...row,localStatus:'unavailable',methods:[]});
    const near = await lookup();
    assert.equal(near.branchInventory.coverage.canExpand,true);
    const wider = await lookup({expandSearch:true,includeAll:false});
    assert.deepEqual(wider.branchInventory.stores.map(s=>[s.id,s.quantity]),[['4',2]]);
    process.env[prefix+'DB'] = join(folder,'missing.db');
    assert.equal((await lookup()).branchInventory.status,'source_failed');
  });
}

test('stock surfaces a failed branch directory even if checkout independently confirmed delivery',async()=>{
  const source={product:async()=>[{sku:'42',name:'Teste'}]};
  for (const [localStatus,methods,status] of [
    ['available',[{channel:'delivery'}],'partial'],['lookup_failed',[],'source_failed']
  ]) {
    source.local=async row=>({...row,pickupVerification:{status:'directory_failed'},localStatus,methods});
    const result=await getStock({retailer:'drogariasaopaulo',sku:'42',coordinates:{latitude:1,longitude:1}},{drogariasaopaulo:source});
    assert.equal(result.status,status);
    assert.deepEqual(result.offers[0].methods,methods);
    assert.equal(result.offers[0].pickupVerification.status,'directory_failed');
  }
});
