// Live assortment can change. An unexpected first step means the reference-only
// scenario needs a new example. Unit tests cover that behavior with a fixed catalog.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [zipcode] = process.argv.slice(2);
assert.match(zipcode ?? '',/^\d{5}-?\d{3}$/,'Informe um CEP de teste.');
const client = new Client({name:'reference-pack-followup',version:'1'});
const endpoint = process.env.FARMACIAS_TEST_MCP_URL;
const config = process.env.FARMACIAS_TEST_PLUGIN_CONFIG;
assert.ok(!(endpoint && config),'Escolha um único transporte.');
const server = config ? JSON.parse(await readFile(config,'utf8')).mcpServers['farmacias-br'] :
  {command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]};
const transport = endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
  new StdioClientTransport({...server,env:{...server.env,FARMACIAS_SENTRY_DSN:''}});
const retailers = ['paguemenos','drogariasaopaulo'];
async function ask(query) {
  const result = await client.callTool({name:'plan_purchase',arguments:{
    retailers,origin:{zipcode},items:[{query,quantity:1,includeGenerics:true}],
  }},undefined,{timeout:120000});
  assert.ok(!result.isError);
  assert.deepEqual(result.structuredContent.checkedRetailers,retailers);
  return result.structuredContent;
}

try {
  await client.connect(transport);
  const first = await ask('Teutozol');
  assert.equal(first.nextAction,'clarify_presentation','O catálogo atual precisa oferecer uma escolha de referência para este teste.');
  for (const group of first.results) {
    const [table] = group.tables;
    assert.equal(table.referenceCatalog,'drogasil');
    for (const n of [28,56]) assert.ok(table.presentationChoices.some(title=>title.includes(n+' cápsulas')));
    assert.deepEqual(table.choices,[]);
    assert.deepEqual(table.verifiedChoices,[]);
  }
  const selected = await ask('Teutozol 20 mg 28 cápsulas');
  for (const group of selected.results) {
    const [table] = group.tables;
    if (table.status === 'no_match') {
      assert.deepEqual(table.choices,[]);
      assert.equal(table.requestedBrand?.status,'no_exact_catalog_match');
      assert.ok(selected.equivalenceGuidance?.includes('mesma apresentação'));
      assert.notEqual(group.coverage?.canExpand,true);
      console.log(group.retailerId,'marca ausente e genérico sem confirmação');
    } else {
      assert.ok(table.choices?.length,'A rede precisa retornar uma oferta verificada ou explicar a falta de equivalência.');
      for (const offer of table.choices) {
        assert.match(offer.name,/20\s*mg/i);
        assert.match(offer.name,/28\s*c[áa]psulas/i);
        assert.ok(offer.localStatus);
      }
      console.log(group.retailerId,table.choices.length,'oferta(s) consultada(s)');
    }
  }
  console.log('MCP',client.getServerVersion().version,'confirmou o fluxo de duas perguntas');
} finally {
  await client.close();
}
