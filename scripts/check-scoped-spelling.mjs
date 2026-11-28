// Live test. Checks identification only and never sends a location.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const ids=['drogasil','paguemenos','drogariasaopaulo'];
const exe=path=>fileURLToPath(new URL('../bin/'+path+'.js',import.meta.url));
const exec=promisify(execFile);
const client=new Client({name:'scoped-spelling-check',version:'1'});
async function mcp(op,args) {
  const response=await client.callTool({name:'pharmacy_'+op,arguments:args},undefined,{timeout:180000});
  assert.ok(!response.isError);
  return response.structuredContent;
}
async function cli(op,args) {
  const words=[exe('farmacias'),op,args.query,'--retailers',args.retailers.join(','),'--limit',String(args.limit??7)];
  if(args.declinedTerm) words.push('--declined',args.declinedTerm);
  const {stdout}=await exec(process.execPath,words,{maxBuffer:4*1024*1024,timeout:180000});
  return JSON.parse(stdout);
}
const normalize=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[exe('server')]}));
  for(let mask=1;mask<8;mask++) {
    const retailers=ids.filter((_,i)=>mask & (1<<i));
    for(const call of [mcp,cli]) {
      const initial=await call('search',{query:'morfi',retailers,limit:20});
      assert.deepEqual(initial.results.map(g=>g.retailerId),retailers);
      assert.ok(initial.results.every(g=>g.status==='no_match' && !g.products.length));
      assert.equal(initial.confirmation.question,'Você quis dizer morfina?');
      const accepted=await call('search',initial.confirmation.onYes);
      assert.deepEqual(accepted.results.map(g=>g.retailerId),retailers);
      for(const g of accepted.results) {
        assert.ok(g.products.length>0 && g.products.every(p=>p.activeIngredients.some(i=>/\bmorfina\b/.test(normalize(i)))));
        if(g.retailerId==='paguemenos') assert.deepEqual([...new Set(g.products.map(p=>p.sku))].sort(),['6974','6981','7191'].sort());
      }
      const declined=await call('suggest',initial.confirmation.onNo);
      assert.deepEqual(declined.results.map(g=>g.retailerId),retailers);
      assert.ok(declined.suggestions.length && declined.suggestions.every(s=>normalize(s)!=='morfina'));
      assert.equal(declined.confirmation,undefined);
      console.log(retailers.join('+'),call.name,'confirmed and declined');
    }
  }
} finally {await client.close();}
