// Supply two test origins at runtime. The same named request goes to the CLI and MCP.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const origins = process.argv.slice(2);
if (origins.length !== 2 || origins.some(value => !/^\d{5}-?\d{3}$/.test(value))) throw Error('Supply two test CEPs.');
const retailers = ['drogasil','paguemenos','drogariasaopaulo'];
const client = new Client({name:'shopping-scope-check',version:'1'});
const binary = name => fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));
const execute = promisify(execFile);
const cases = [
  {query:'ibuprofeno 600 mg 20 comprimidos', scope:{}, flags:[], expected:retailers},
  {query:'paracetamol 750 mg 20 comprimidos', scope:{retailer:'drogasil'}, flags:['--retailer','drogasil'], expected:['drogasil']},
  {query:'paracetamol 750 mg 20 comprimidos', scope:{retailers:retailers.slice(1)}, flags:['--retailers',retailers.slice(1).join(',')], expected:retailers.slice(1)},
];

function verify(data, expected, singleton, surface) {
  const rows = singleton ? [{...data,retailerId:expected[0]}] : data.results;
  if (!singleton) assert.deepEqual(data.checkedRetailers,expected);
  assert.deepEqual(rows.map(row=>row.retailerId),expected);
  for (const row of rows) {
    assert.notEqual(row.status,'source_failed',row.retailerId);
    assert.equal(row.tables.length,1,row.retailerId);
    if (row.retailerId === 'drogasil') {
      const table=row.tables[0];
      assert.ok(row.coverage?.checkedStores>0 || (['presentation_options','ambiguous'].includes(table.status) && table.candidates.length>1));
    } else {
      assert.equal(row.stockEvidence,'fulfillment_quote');
      assert.ok(row.tables[0].choices.length);
      assert.ok(row.tables[0].choices.every(p=>p.branchQuantity===null));
      for (const product of row.tables[0].choices) for (const method of product.methods) {
        if (method.pickupPointId) assert.ok(row.pickupPoints.some(p=>p.pickupPointId===method.pickupPointId));
      }
    }
  }
  console.log('PASS',surface,expected.join('+'));
}

try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[binary('server')]}));
  for (const [i,{query,scope,flags,expected}] of cases.entries()) {
    const zipcode=origins[i%origins.length];
    const {stdout}=await execute(process.execPath,[binary('farmacias'),'plan',query,'--cep',zipcode,...flags],{maxBuffer:16*1024*1024,timeout:240000});
    verify(JSON.parse(stdout),expected,Boolean(scope.retailer),'CLI');
    const result=await client.callTool({name:'plan_purchase',arguments:{...scope,origin:{zipcode},items:[{query}]}},undefined,{timeout:240000});
    assert.ok(!result.isError,result.content[0]?.text?.slice(0,250));
    verify(result.structuredContent,expected,Boolean(scope.retailer),'MCP');
  }
} finally {await client.close();}
