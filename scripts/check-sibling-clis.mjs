// Exercise the actual executable shipped by every partner adapter using its pinned dependency.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const origins=process.argv.slice(2);
assert.ok(origins.length===2 && origins.every(s=>/^\d{5}-?\d{3}$/.test(s)), 'Supply both test CEPs');
const samples={paguemenos:'1633706',drogariasaopaulo:'883646'};
let checks=0;
const directory=await mkdtemp(resolve(tmpdir(),'retailer-cli-parity-'));
const options={timeout:180000,maxBuffer:16*1024*1024,env:{...process.env,DROGASIL_SNAPSHOT_DB:resolve(directory,'runs.sqlite')}};
try {
for(const [i,[retailer,sku]] of Object.entries(samples).entries()) {
  const dir=dirname(fileURLToPath(import.meta.resolve(retailer+'-cli')));
  const pkg=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'));
  const cli=resolve(dir,pkg.bin[retailer]);
  async function call(command,...args) {
    const {stdout}=await execute(process.execPath,[cli,command,...args,'--json'],options);
    return JSON.parse(stdout);
  }
  assert.ok((await call('suggest','lorata')).includes('loratadina')); checks++;
  assert.ok((await call('search','loratadina','--limit','1')).length); checks++;
  const [p]=await call('product',sku);
  assert.equal(p.sku,sku); assert.ok(p.gtin); checks++;
  const [facts]=await call('info',sku);
  assert.equal(facts.sku,sku); assert.equal(facts.gtin,p.gtin); checks++;
  const barcode=await call('gtin',p.gtin);
  assert.ok(barcode.some(r=>r.sku===sku) && barcode.every(r=>r.gtin===p.gtin)); checks++;
  const stock=await call('stock',sku,'--cep',origins[i%2],'--quantity','2');
  assert.ok(stock.length && stock.every(r=>r.sku===sku && r.requestedQuantity===2)); checks++;
  const info=await call('info','Rivotril','tansulosina','--brazil');
  assert.equal(info.results.length,2);
  assert.ok(info.results.every(r=>r.products.length && 'brazil' in r)); checks++;
  const compare=await call('compare',sku,'--brand-only','--cep',origins[i%2]);
  assert.ok(compare.products.length && compare.products.every(p=>p.sku===sku && p.branchQuantity===null && p.localStatus!=='lookup_failed')); checks++;
  const stores=await call('stores','--cep',origins[i%2]);
  assert.ok(stores.some(store=>store.id && store.storeName)); checks++;
  const plan=await call('plan',sku,'--cep',origins[i%2],'--quantity','A=2');
  assert.equal(plan.items[0].requestedQuantity,2); checks++;
  const human=await execute(process.execPath,[cli,'stock',sku,'--cep',origins[i%2]],options);
  assert.match(human.stdout,/Qtd\. solicitada/); assert.match(human.stdout,/Atendimento/); checks++;
  const run=await call('snapshot','collect','loratadina','--limit','2');
  assert.equal(run.state,'succeeded');
  const batch=await call('snapshot','read',run.runId,'--offset','1','--limit','1');
  assert.equal(batch.records.length,1); checks++;
  const exported=await call('snapshot','export',run.runId,'--format','json');
  assert.deepEqual(exported.map(x=>x.retailerId),[retailer,retailer]);
  const csv=await execute(process.execPath,[cli,'snapshot','export',run.runId,'--format','csv'],options);
  assert.match(csv.stdout.split('\n')[0],/searchQuery/);
  const xlsx=await execute(process.execPath,[cli,'snapshot','export',run.runId,'--format','xlsx'],{...options,encoding:'buffer'});
  assert.equal(xlsx.stdout.readUInt32LE(),0x04034b50); checks++;
  console.log(retailer,'passed');
}
} finally { await rm(directory,{recursive:true,force:true}); }
console.log(JSON.stringify({checks}));
