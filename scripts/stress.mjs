// All traffic goes to the in-process loopback service. The full-size dataset
// uses deterministic fixture sources and a private temporary SQLite database.
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { localApp } from '../src/server.js';
import { collectSnapshot, readSnapshot } from 'drogasil-cli';

const dir = await mkdtemp(join(tmpdir(), 'farmacias-stress-'));
process.env.DROGASIL_SNAPSHOT_DB = join(dir,'runs.sqlite');
const listener = localApp().listen(0,'127.0.0.1'); await once(listener,'listening');
const base = 'http://127.0.0.1:'+listener.address().port;
const latencies = [];
try {
  await Promise.all(Array.from({length:24}, async()=> {
    for(let i=0;i<40;i++) {
      const start=performance.now();
      const bad=i%4===0;
      const res=bad ? await fetch(base+'/api/v1/stock',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
        : await fetch(base+'/api/v1/retailers');
      const data=await res.json();
      assert.equal(res.status,bad?400:200);
      if(!bad) assert.equal(data.length,4);
      latencies.push(performance.now()-start);
    }
  }));
  const queries=Array.from({length:10},(_,i)=>'q'+i);
  const search=async (q,{page})=>{
    const start=queries.indexOf(q)*100+page*60;
    return { hits:Array.from({length:60},(_,i)=>({sku:String(start+i+1)})),nbPages:2 };
  };
  const read=async (hit,query)=>({snapshot:{sku:hit.sku,name:'Fixture '+hit.sku,searchQuery:query},html:''});
  const {runId}=await collectSnapshot(queries,{maxItems:1000,background:true},{search,read});
  let state;
  for(let i=0;i<240;i++){
    state=await readSnapshot(runId,{limit:1});
    if(state.state!=='running') break;
    await new Promise(r=>setTimeout(r,500));
  }
  assert.equal(state.state,'succeeded'); assert.equal(state.count,1000);
  const pages=await Promise.all(Array.from({length:10},(_,i)=>readSnapshot(runId,{limit:100,offset:i*100})));
  const all=pages.flatMap(p=>p.records);
  assert.equal(new Set(all.map(p=>p.sku)).size,1000);
  assert.equal(all.find(p=>p.sku==='101').searchQuery,'q0');
  latencies.sort((a,b)=>a-b);
  console.log(JSON.stringify({httpRequests:latencies.length,concurrency:24,p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),snapshotRows:all.length,uniqueQueries:queries.length,peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024)}));
} finally { await new Promise(resolve=>listener.close(resolve)); await rm(dir,{recursive:true,force:true}); }
