// Run against participating stores. Synthetic tests cover all-zero combinations when live stock changes.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origins = process.argv.slice(2);
assert.ok(origins.length === 2 && origins.every(s=>/^\d{5}-?\d{3}$/.test(s)),'Supply two test CEPs');
const all = ['drogasil','paguemenos','drogariasaopaulo'];
const item = {query:'Patz GTS em gotas, frasco de 20 mL',brand:'Patz GTS',includeGenerics:false};
const exec = promisify(execFile);
const bin = name => fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));
const client = new Client({name:'expanded-basket-check',version:'1'});

async function mcp(retailers,zipcode,expandSearch) {
  const response = await client.callTool({name:'plan_purchase',
    arguments:{retailers,origin:{zipcode},items:[item],expandSearch}},undefined,{timeout:240000});
  assert.ok(!response.isError);
  return response.structuredContent;
}

async function cli(retailers,zipcode,expandSearch) {
  const args=[bin('farmacias'),'plan',item.query,'--brand','A='+item.brand,'--brand-only','A',
    '--retailers',retailers.join(','),'--cep',zipcode];
  if (expandSearch) args.push('--expand');
  const {stdout}=await exec(process.execPath,args,{maxBuffer:16_000_000,timeout:240000});
  return JSON.parse(stdout);
}

try {
  const endpoint=process.env.FARMACIAS_TEST_MCP_URL;
  await client.connect(endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
    new StdioClientTransport({command:process.execPath,args:[bin('server')]}));
  for (const [index,mask] of [1,1,2,3,4,5,6,7].entries()) {
    const retailers=all.filter((_,index)=>mask & (1<<index));
    for (const [surface,lookup] of [['CLI',cli],['MCP',mcp]]) {
      const zipcode=origins[index%2];
      const initial=await lookup(retailers,zipcode,false);
      assert.deepEqual(initial.checkedRetailers,retailers);
      assert.ok(initial.results.every(r=>r.status!=='source_failed'));
      assert.equal(initial.expandedSearch,undefined);
      if (!initial.coverage.canExpand) {
        console.log(surface,retailers.join('+'),'local search only');
        continue;
      }
      assert.ok(initial.coverage.checkedStores>0 && initial.coverage.allZero && !initial.coverage.stockUnknown);
      const accepted=await lookup(retailers,zipcode,true);
      assert.equal(accepted.coverage.canExpand,false);
      if (accepted.expandedSearch) {
        const {stores,radiusKm,advice}=accepted.expandedSearch;
        assert.equal(radiusKm,25);
        assert.ok(stores.length<=10);
        assert.match(advice,/ligue/i);
        for (const [i,store] of stores.entries()) {
          assert.ok(retailers.includes(store.retailerId));
          assert.ok(Number.isFinite(store.distanceKm) && store.distanceKm>=0 && store.distanceKm<=25);
          assert.ok(!i || store.distanceKm>=stores[i-1].distanceKm);
          assert.ok(store.stocks.length && store.stocks.every(s=>s.quantity>=1));
        }
        console.log(surface,retailers.join('+'),'accepted',stores.length,'stocked branches shown');
      } else {
        assert.equal(accepted.coverage.allZero,false,'Wider lookup was lost after confirmed zero');
        console.log(surface,retailers.join('+'),'local evidence changed before acceptance');
      }
    }
  }
} finally {await client.close();}
