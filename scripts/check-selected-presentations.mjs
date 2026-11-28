// Compare the same explicitly requested pack by name on both public surfaces.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origins=process.argv.slice(2);
assert.ok(origins.length===2 && origins.every(s=>/^\d{5}-?\d{3}$/.test(s)), 'Supply two test CEPs');
const bin=file=>fileURLToPath(new URL('../bin/'+file,import.meta.url));
const query='Frontal 2 mg 30 comprimidos de liberação imediata';
const ids=['drogasil','paguemenos','drogariasaopaulo'];
const run=promisify(execFile);
const client=new Client({name:'presentations-acceptance',version:'1'});
const expected=new Map();
function verifyProducts(group, local, fixed) {
  if (local && group.status==='no_stock') {
    assert.equal(group.retailerId,'drogasil');assert.equal(group.coverage.stockUnknown,false);return;
  }
  assert.ok(group.status==='matches' || (fixed && group.status==='pickup_not_offered'),group.retailerId+' '+group.status);
  const names=group.products.map(p=>p.name);
  assert.ok(names.length);
  let generic=false;
  for(const p of group.products){
    assert.match(p.name,/\b2\s*mg\b/i);
    assert.match(p.name,/\b30\s*comprimidos?/i);
    assert.doesNotMatch(p.name,/\bxr\b|prolongada|porta[- ]?comprimido/i);
    if(p.role==='generic'){
      generic=true;
      assert.equal(p.type,'Genérico');
      assert.match(p.name,/alprazolam/i);
    } else {
      assert.equal(p.role,'requested');assert.match(p.name,/frontal/i);assert.ok(!generic);
    }
    if(local && group.retailerId==='drogasil') {
      assert.equal(p.priceScope,'catalog_reference');
      if(fixed) assert.ok(p.stores.every(s=>s.id===group.fixedStore.branch.id));
      else assert.ok(p.closestStore?.quantity>0 && p.stores.every(s=>s.quantity>0));
    }
    if(local && group.retailerId!=='drogasil') {
      assert.ok(Array.isArray(p.methods));
      if (!group.purchase?.stockEvidence || group.stockEvidence==='fulfillment_quote') assert.equal(p.branchQuantity,null);
      if(fixed && p.pickupAtStore==='offered') assert.ok(p.methods.some(m=>m.channel==='pickup-in-point'));
    }
  }
  if(!local) {
    assert.ok(generic,group.retailerId+' expected live generic');
    const keys=group.products.map(p=>[String(p.sku),p.sellerId??null,p.role]);
    if(expected.has(group.retailerId)) assert.deepEqual(keys,expected.get(group.retailerId));
    else expected.set(group.retailerId,keys);
  }
}
try {
  const url=process.env.FARMACIAS_TEST_MCP_URL;
  await client.connect(url ? new StreamableHTTPClientTransport(new URL(url)) :
    new StdioClientTransport({command:process.execPath,args:[bin('server.js')]}));
  console.log('MCP',client.getServerVersion().version);
  for(const [i,mask] of [1,2,4,3,5,6,7].entries()){
    const retailers=ids.filter((_,bit)=>mask & (1<<bit));
    const zipcode=origins[i%2];
    for(const local of [false,true]) {
      const fixed=local && i%2===1;
      const args={retailers,query,includeGenerics:true,...(local&&{zipcode}),...(fixed&&{store:'nearest'})};
      const flags=['--retailers',retailers.join(','),'--generics',...(local?['--cep',zipcode]:[]),...(fixed?['--store','nearest']:[])];
      for(const surface of ['cli','mcp']){
        let result;
        if(surface==='cli'){
          const p=await run(process.execPath,[bin('farmacias.js'),'compare',query,...flags],{timeout:240000,maxBuffer:16*1024*1024});
          result=JSON.parse(p.stdout);
        }else{
          const response=await client.callTool({name:'pharmacy_compare',arguments:args},undefined,{timeout:240000});
          assert.ok(!response.isError);result=response.structuredContent;
        }
        assert.deepEqual(result.results.map(g=>g.retailerId),retailers);
        for(const group of result.results) verifyProducts(group,local,fixed);
        if(fixed) assert.ok(['identified','unconfirmed'].includes(result.nearestAmongSelected.status));
        if(local) assert.equal(result.coverage.canExpand,false);
        console.log(surface,retailers.join('+'),local?(fixed?'fixed':'nearby'):'catalog','passed');
      }
    }
  }
}finally{await client.close()}
