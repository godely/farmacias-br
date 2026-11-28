// Explicit live check. Store each run in a disposable database and verify one
// product per requested chain through the same executables a client installs.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const hosts = {drogasil:'www.drogasil.com.br', paguemenos:'www.paguemenos.com.br', drogariasaopaulo:'www.drogariasaopaulo.com.br'};
const query = process.argv[2];
const terms = query === undefined ? [] : [query];
const dir = await mkdtemp(join(tmpdir(),'farmacias-snapshots-'));
const env = {DROGASIL_SNAPSHOT_DB:join(dir,'runs.sqlite'), FARMACIAS_SENTRY_DSN:''};
const run = promisify(execFile);
const entry = name => fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));
async function cli(name,...args) {
  const {stdout} = await run(process.execPath,[entry('farmacias'),name,...args],{env:{...process.env,...env},timeout:120000});
  return JSON.parse(stdout);
}
const client = new Client({name:'snapshot-check',version:'1'});
async function mcp(name,args) {
  const reply = await client.callTool({name:'pharmacy_'+name,arguments:args});
  assert.ok(!reply.isError,name);
  return reply.structuredContent;
}

function verifyRow(row, retailer) {
  assert.equal(row.searchQuery,query ?? 'paracetamol');
  assert.equal(new URL(row.productUrl).hostname,hosts[retailer]);
  assert.equal(new URL(row.sourceUrl).hostname,hosts[retailer]);
  assert.ok(Number.isFinite(Date.parse(row.scrapedAt)));
  for (const key of ['seller','currentPrice','listPrice','currency','discountPercentage','stockSignal','inStock','categories','categoryPath']) {
    assert.ok(Object.hasOwn(row,key),key);
  }
  if (retailer === 'drogasil') return;
  assert.equal(row.retailerId,retailer);
  assert.ok(row.offers.length > 0);
  const defaults = row.offers.filter(o => o.isDefaultSeller === true);
  const offer = row.offers.length === 1 ? row.offers[0] : defaults.length === 1 ? defaults[0] : null;
  for (const key of ['seller','currentPrice','listPrice','inStock','currency']) assert.equal(row[key],offer?.[key] ?? null);
  assert.equal(row.stockSignal,offer?.onlineStockSignal ?? null);
}

let failures = 0;
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[entry('server')],env}));
  for (const surface of ['cli','mcp']) {
    for (let mask = 1; mask < 8; mask++) {
      const retailers = Object.keys(hosts).filter((_,i)=>mask & (1<<i));
      try {
        const {runs} = surface === 'cli'
          ? await cli('snapshot',...terms,'--retailers',retailers.join(','),'--max-items','1')
          : await mcp('snapshot',{...(terms.length && {queries:terms}),retailers,maxItems:1});
        assert.deepEqual(runs.map(r=>r.retailerId),retailers);
        assert.equal(new Set(runs.map(r=>r.runId)).size,runs.length);
        for (const {runId,retailerId} of runs) {
          assert.ok(runId,retailerId+' did not start');
          const deadline = Date.now()+120000;
          let page;
          do {
            page = surface === 'cli' ? await cli('read_snapshot',runId) : await mcp('read_snapshot',{runId});
            if (page.state === 'running') await wait(350);
          } while (page.state === 'running' && Date.now()<deadline);
          assert.equal(page.state,'succeeded',retailerId+' '+(page.error ?? page.state));
          assert.equal(page.count,1,retailerId);
          verifyRow(page.records[0],retailerId);
          assert.deepEqual(await cli('export_snapshot',runId,'--format','json'),page.records);
        }
        console.log('PASS',surface,retailers.join('+'));
      } catch (error) {
        failures++;
        console.error('FAIL',surface,retailers.join('+'),error.message);
      }
    }
  }
} finally {
  await client.close();
  await rm(dir,{recursive:true,force:true});
}
if (failures) process.exitCode = 1;
