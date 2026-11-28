// No arguments checks national directories. Two caller-supplied CEPs check live local directories.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ceps=process.argv.slice(2);
assert.ok(ceps.length === 0 || ceps.length === 2 && ceps.every(s=>/^\d{5}-?\d{3}$/.test(s)),'Supply two test CEPs');
const bin=name=>fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));
const run=promisify(execFile);
const ids=['drogasil','paguemenos','drogariasaopaulo'];
const version=createRequire(import.meta.url)('../package.json').version;
const endpoint=process.env.FARMACIAS_TEST_MCP_URL;
const client=new Client({name:'selected-directory-check',version:'1'});
function verify(data,retailers,local) {
  assert.equal(data.status,'checked');
  assert.deepEqual(data.results.map(r=>r.retailerId),retailers);
  for (const r of data.results) {
    assert.equal(r.page,1);
    assert.ok(r.total >= r.stores.length && r.stores.length > 0 && r.stores.length <= 3);
    assert.ok(r.source.startsWith('https://www.'));
    for (const store of r.stores) {
      assert.ok(store.displayName || store.storeName);
      assert.ok(store.address.street);
      assert.ok(!('inStock' in store || 'quantity' in store));
    }
    if (!local) {
      assert.equal(r.order,'directory');
      assert.ok(r.stores.every(s=>s.distanceKm==null));
      if (r.retailerId === 'paguemenos') {
        assert.equal(r.scope,'national_observed');
        assert.equal(r.coverage.states,27);
        assert.equal(r.coverage.complete,null);
        assert.equal(r.total,r.coverage.uniqueStores);
        assert.ok(r.stores.every(s=>s.directoryObservedAt === r.observedAt));
      } else assert.equal(r.scope,'national');
    } else if (r.retailerId === 'drogasil') {
      assert.ok(['neighborhood','city'].includes(r.scope));
      assert.equal(r.order,'directory');
      assert.ok(r.stores.some(s=>s.openingHours.length && s.displayName && s.displayName !== 'DROGASIL'));
    } else {
      assert.ok(r.stores.some(s=>s.openingHours?.weekdays));
      const known=r.stores.map(s=>s.distanceKm).filter(Number.isFinite);
      assert.equal(known.length,r.stores.length);
      assert.deepEqual(known,[...known].sort((a,b)=>a-b));
    }
  }
}
let failures=0;
try {
  await client.connect(endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
    new StdioClientTransport({command:process.execPath,args:[bin('server')]}));
  assert.equal(client.getServerVersion()?.version,version,'MCP version differs from tested CLI');
  for (const [i,mask] of [1,2,4,3,5,6,7].entries()) {
    const retailers=ids.filter((_,bit)=>mask & 1<<bit);
    const zipcode=ceps[i%2];
    const origin=zipcode ? {zipcode} : {};
    for (const surface of ['cli','mcp']) {
      try {
        let data;
        if (surface==='cli') {
          const r=await run(process.execPath,[bin('farmacias'),'stores','--retailers',retailers.join(','),...(zipcode ? ['--cep',zipcode] : []),'--limit','3'],
            {timeout:90000});
          data=JSON.parse(r.stdout);
        } else {
          const r=await client.callTool({name:'pharmacy_stores',arguments:{retailers,...origin,limit:3}});
          assert.ok(!r.isError); data=r.structuredContent;
        }
        verify(data,retailers,Boolean(zipcode));
        console.log('PASS',surface,retailers.join('+'));
      } catch (error) {
        failures++;
        console.error('FAIL',surface,retailers.join('+'),error.code ?? error.name);
      }
    }
  }
} finally {await client.close();}
if (failures) process.exitCode=1;
