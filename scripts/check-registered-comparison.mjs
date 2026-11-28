// Run with a caller-supplied test CEP. Live catalogs can change independently of this release.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [zipcode] = process.argv.slice(2);
assert.match(zipcode ?? '',/^\d{5}-?\d{3}$/,'Informe um CEP de teste.');
const client = new Client({name:'registered-presentation-comparison',version:'1'});
const endpoint = process.env.FARMACIAS_TEST_MCP_URL;
const transport = endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
  new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]});
const query='Sinvasmax 20 mg 30 comprimidos';
const retailer='paguemenos';
try {
  await client.connect(transport);
  for (const [name,args] of [
    ['pharmacy_compare',{retailer,query,includeGenerics:true,zipcode}],
    ['plan_purchase',{retailers:[retailer],origin:{zipcode},items:[{query,quantity:1,includeGenerics:true}]}],
  ]) {
    const response=await client.callTool({name,arguments:args},undefined,{timeout:150000});
    assert.ok(!response.isError,response.content?.[0]?.text);
    const data=response.structuredContent;
    const result=data.results?.[0] ?? data, table=result.tables?.[0] ?? result;
    assert.equal(table.requestedBrand?.status,'no_exact_catalog_match');
    assert.equal(data.nextAction,'show_presentation_comparisons');
    assert.equal(table.registeredPresentation.category,'Similar');
    assert.equal(table.comparisonStatus,'documented');
    assert.ok(table.comparisonOptions.length,'O catálogo atual precisa oferecer uma apresentação correspondente.');
    assert.equal((table.verifiedChoices ?? result.products ?? []).length,0);
    const pickup=[];
    for (const option of table.comparisonOptions) {
      assert.ok(option.registeredRecords.length && option.name && option.role==='presentation_comparison');
      assert.equal(option.branchQuantity,null);
      assert.equal(option.requestedQuantity,1);
      if (option.localStatus==='available' && option.methods.some(m=>m.channel==='pickup-in-point' && m.pickupPointId))
        pickup.push(option.name);
    }
    assert.ok(pickup.length,'Nenhuma retirada confirmada neste CEP para a oferta atual.');
    assert.ok(!data.crossRetailerPlans?.plans?.length && !result.pickupPlans?.plans?.length);
    console.log(name,table.comparisonOptions.length,'ofertas,',pickup.length,'com retirada;',pickup.join(' / '));
  }
  const alongside=await client.callTool({name:'plan_purchase',arguments:{
    retailers:['paguemenos','drogariasaopaulo'],origin:{zipcode},items:[{query,quantity:1,includeGenerics:true}],
  }},undefined,{timeout:240000});
  assert.ok(!alongside.isError,alongside.content?.[0]?.text);
  const data=alongside.structuredContent;
  assert.deepEqual(data.results.map(row=>row.retailerId),['paguemenos','drogariasaopaulo']);
  const [absent,listed]=data.results.map(row=>row.tables[0]);
  assert.equal(absent.requestedBrand.status,'no_exact_catalog_match');
  assert.equal(listed.requestedBrand.status,'listed');
  assert.ok(listed.choices.length && listed.choices.every(o=>/sinvasmax/i.test(o.name)));
  assert.ok(listed.comparisonOptions.length);
  for (const option of listed.comparisonOptions) {
    assert.equal(option.role,'presentation_comparison');
    assert.equal(option.branchQuantity,null);
    assert.equal(option.requestedQuantity,1);
  }
  for (const plan of data.crossRetailerPlans?.plans ?? []) {
    for (const stop of plan.stops) for (const pickup of stop.pickups) assert.match(pickup.name,/sinvasmax/i);
  }
  console.log('Drogaria São Paulo:',listed.choices[0].name,'primeiro;',listed.comparisonOptions.length,'genéricos comparados separadamente.');
  console.log('MCP',client.getServerVersion().version);
} finally { await client.close(); }
