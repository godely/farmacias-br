import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origins = process.argv.slice(2);
assert.ok(origins.length === 2 && origins.every(cep => /^\d{5}-?\d{3}$/.test(cep)), 'Supply two test CEPs.');
const client = new Client({name:'shopping-followups',version:'1'});
const url = process.env.FARMACIAS_TEST_MCP_URL;
const transport = url ? new StreamableHTTPClientTransport(new URL(url)) :
  new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]});
async function call(name, args) {
  const response = await client.callTool({name,arguments:args},undefined,{timeout:120000});
  assert.ok(!response.isError,name+' failed');
  return response.structuredContent;
}

try {
  await client.connect(transport);
  const retailers = ['paguemenos','drogariasaopaulo'];
  const all = ['drogasil',...retailers];
  for (let mask=1;mask<8;mask++) {
    const ids = all.filter((_,i) => mask & (1 << i));
    const scope = ids.length === 1 ? {retailer:ids[0]} : {retailers:ids};
    const answer = await call('pharmacy_suggest',{...scope,query:'loratadnia',declinedTerm:'loratadina'});
    assert.ok(['suggestions','no_suggestions'].includes(answer.status),ids.join(', '));
    assert.ok(answer.suggestions.every(term => !/\bloratadina\b/iu.test(term)));
    assert.equal(answer.interaction,answer.suggestions.length ? 'awaiting_alternative_name' : 'awaiting_spelling');
    console.log(ids.join(' + '),answer.interaction);
  }
  const phrases = ['Patz GTS','Patz GTS em gotas, frasco de 20 mL'];
  const accepted = new Map();
  for (const [i,query] of phrases.entries()) {
    const {coverage,results} = await call('plan_purchase',{
      retailers:all,origin:{zipcode:origins[i]},items:[{query,brand:'Patz GTS',includeGenerics:false}],
    });
    assert.equal(coverage.canExpand,false);
    for (const id of retailers) {
      const result = results.find(r => r.retailerId === id);
      const choices = result.tables[0].choices;
      assert.ok(choices.length && choices.every(row=>row.gtin === '7894916513005'),id+' exact 20 mL drops');
      assert.ok(choices.every(row=>row.localStatus && row.localStatus!=='source_failed'),id+' local lookup');
      const skus = [...new Set(choices.map(c=>c.sku))].sort();
      if (i) assert.deepEqual(skus,accepted.get(id));
      else accepted.set(id,skus);
      console.log(id,query,result.status);
    }
  }
  for (const query of ['Patz GTS gotas 30 mL','Patz GTS 5 mg/mL gotas 20 mL','Patz GTS XR gotas 20 mL']) {
    for (const retailer of retailers) {
      const result = await call('pharmacy_compare',{retailer,query,includeGenerics:false});
      assert.equal(result.status,'no_match',retailer+' '+query);
      assert.equal(result.products.length,0);
    }
  }
  console.log('Todas as apresentações incompatíveis foram recusadas.');
} finally {
  await client.close();
}
