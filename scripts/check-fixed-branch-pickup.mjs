// Caller supplies both origins. Verify the selected branch against a fresh, independent checkout.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {providers} from '../src/providers.js';

const ceps=process.argv.slice(2);
assert.ok(ceps.length === 2 && ceps.every(s=>/^\d{5}-?\d{3}$/.test(s)), 'Informe dois CEPs de teste');
const query='paracetamol Prati 750 mg 20 comprimidos';
const presentation='7899547543766';
const run=promisify(execFile);
const client=new Client({name:'check-fixed-branch-pickup',version:'1'});
const endpoint=process.env.FARMACIAS_TEST_MCP_URL;
const path = file => fileURLToPath(new URL(file,import.meta.url));
async function cli(bin,args) {
  let output;
  try {output=await run(process.execPath,[bin,...args],{maxBuffer:5_000_000});}
  catch(error) {if(error.code!==3) throw error; output=error;}
  return JSON.parse(output.stdout);
}
async function tool(name,args) {
  const res=await client.callTool({name,arguments:args},undefined,{timeout:180000});
  assert.ok(!res.isError,name);
  return res.structuredContent;
}
try {
  await client.connect(endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
    new StdioClientTransport({command:process.execPath,args:[path('../bin/server.js')]}));
  for(const [i,retailer] of ['paguemenos','drogariasaopaulo'].entries()) {
    const cep=ceps[i];
    const source=providers[retailer];
    const [directory,offers]=await Promise.all([source.stores(cep),source.byGtin(presentation)]);
    const [branch]=directory.filter(s=>Number.isFinite(s.distanceKm)).sort((a,b)=>a.distanceKm-b.distanceKm || a.id.localeCompare(b.id));
    assert.ok(branch && offers.length);
    const direct=new Map();
    for(const offer of offers) {
      const quote=await source.local(offer,cep,1);
      const pattern=retailer==='paguemenos' ? new RegExp('^paguemenos0*'+branch.id+'_','i') :
        new RegExp('^(?:drogariasaopaulo|drogariasp).*_'+branch.id+'$','i');
      const points=quote.methods.filter(m=>m.channel==='pickup-in-point' && pattern.test(m.pickupPointId));
      direct.set(offer.sku+':'+offer.sellerId,points.map(p=>p.pickupPointId));
    }
    const bin=fileURLToPath(new URL('cli.js',import.meta.resolve(retailer+'-cli')));
    const scope=['--cep',cep,'--store','nearest'];
    const plan={retailer,origin:{zipcode:cep},store:'nearest',items:[{query,brand:'Prati',includeGenerics:false}]};
    const compare={retailer,query,zipcode:cep,store:'nearest',includeGenerics:false};
    for(const [label,lookup] of [
      ['standalone plan',()=>cli(bin,['plan',query,'--brand','A=Prati','--brand-only','A',...scope,'--json'])],
      ['standalone compare',()=>cli(bin,['compare',query,'--brand-only',...scope,'--json'])],
      ['Farmácias CLI plan',()=>cli(path('../bin/farmacias.js'),['plan',query,'--brand','A=Prati','--brand-only','A','--retailer',retailer,...scope])],
      ['Farmácias CLI compare',()=>cli(path('../bin/farmacias.js'),['compare',query,'--retailer',retailer,...scope])],
      ['MCP plan_purchase',()=>tool('plan_purchase',plan)],
      ['MCP pharmacy_compare',()=>tool('pharmacy_compare',compare)],
    ]) {
      const result=await lookup();
      assert.equal(result.fixedStore?.branch?.id,branch.id,label);
      const rows=result.products ?? result.tables?.[0]?.choices;
      assert.ok(rows?.length,label);
      for(const row of rows) {
        assert.equal(row.gtin,presentation,label);
        const expected=direct.get(row.sku+':'+row.sellerId);
        assert.ok(expected,label);
        assert.equal(row.branchQuantity,null,label);
        assert.equal(row.pickupAtStore,expected.length?'offered':'not_offered',label);
        assert.deepEqual([...new Set(row.methods.map(m=>m.pickupPointId))].sort(),[...new Set(expected)].sort(),label);
      }
      console.log(retailer,label,branch.storeName,rows.map(p=>p.pickupAtStore).join(', '));
    }
  }
} finally {await client.close();}
