// Supply a test CEP where both requested presentations currently have a pickup offer.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [zipcode] = process.argv.slice(2);
assert.match(zipcode ?? '', /^\d{5}-?\d{3}$/, 'Informe um CEP de teste');
const retailers = ['paguemenos','drogariasaopaulo'];
const items = [
  {query:'Dimorf em gotas', brand:'Dimorf', includeGenerics:false},
  {query:'Descongestionante nasal spray Ever Care', brand:'Ever Care', includeGenerics:false},
];
const bin = file => fileURLToPath(new URL('../bin/'+file+'.js',import.meta.url));
const exec = promisify(execFile);
const client = new Client({name:'check-retained-basket',version:'1'});

async function cli(lines) {
  const flags = lines.flatMap((line,index) => {
    const label = String.fromCharCode(65+index);
    const selections = Object.entries(line.selectedSkus ?? {}).flatMap(([id,sku])=>['--sku',label+'='+id+':'+sku]);
    return ['--brand',label+'='+line.brand,'--brand-only',label,...selections];
  });
  const {stdout} = await exec(process.execPath,[bin('farmacias'),'plan',...lines.map(line=>line.query),
    '--retailers',retailers.join(','),'--cep',zipcode,...flags],{maxBuffer:16_000_000,timeout:240000});
  return JSON.parse(stdout);
}

async function mcp(lines) {
  const response = await client.callTool({name:'plan_purchase',arguments:{retailers,items:lines,origin:{zipcode}}},
    undefined,{timeout:240000});
  assert.ok(!response.isError);
  assert.equal(response.structuredContent.nextAction,'answer_with_plan');
  return response.structuredContent;
}

function chosenProducts(result) {
  assert.deepEqual(result.checkedRetailers,retailers);
  const plan = result.crossRetailerPlans?.plans?.[0];
  assert.ok(plan, 'A consulta atual precisa oferecer retirada para ambas as apresentações');
  const choices = [];
  for (const stop of plan.stops) {
    assert.ok(stop.id);
    for (const line of stop.pickups) {
      assert.equal(line.evidence,'quoted_pickup');
      assert.equal(line.packs,1);
      assert.match(line.name,line.item===0 ? /dimorf/i : /ever\s*care/i);
      assert.ok(!choices[line.item]);
      choices[line.item] = {retailer:stop.retailerId,sku:line.sku,name:line.name};
    }
  }
  assert.ok(items.every((_,i)=>Boolean(choices[i])));
  return choices;
}

try {
  const url = process.env.FARMACIAS_TEST_MCP_URL;
  await client.connect(url ? new StreamableHTTPClientTransport(new URL(url)) :
    new StdioClientTransport({command:process.execPath,args:[bin('server')]}));
  for (const [surface,lookup] of [['CLI',cli],['MCP',mcp]]) {
    const result = await lookup(items);
    const chosen = chosenProducts(result);
    const retained = items.map((line,i) => ({...line,selectedSkus:{[chosen[i].retailer]:chosen[i].sku}}));
    const refreshed = await lookup(retained);
    assert.deepEqual(chosenProducts(refreshed),chosen);
    for (const [i,choice] of chosen.entries()) {
      const table = refreshed.results.find(r=>r.retailerId===choice.retailer).tables[i];
      assert.ok(table.choices.length && table.choices.every(p=>p.sku===choice.sku));
    }
    const plan = refreshed.crossRetailerPlans.plans[0];
    console.log(surface,chosen.map(p=>p.name).join(' + '),plan.stopCount+' parada(s)',plan.totalBRL+' BRL');
  }
} finally {await client.close();}
