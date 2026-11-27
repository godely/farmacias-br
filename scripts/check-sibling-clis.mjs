// Exercise the actual executable shipped by every partner adapter using its pinned dependency.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const origins=process.argv.slice(2);
assert.ok(origins.length===2 && origins.every(s=>/^\d{5}-?\d{3}$/.test(s)), 'Supply both test CEPs');
const samples={paguemenos:'1633706',drogariasaopaulo:'883646'};
let checks=0;
for(const [i,[retailer,sku]] of Object.entries(samples).entries()) {
  const dir=dirname(fileURLToPath(import.meta.resolve(retailer+'-cli')));
  const pkg=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'));
  const cli=resolve(dir,pkg.bin[retailer]);
  async function call(command,...args) {
    const {stdout}=await execute(process.execPath,[cli,command,...args,'--json'],{timeout:180000});
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
  console.log(retailer,'passed');
}
console.log(JSON.stringify({checks}));
