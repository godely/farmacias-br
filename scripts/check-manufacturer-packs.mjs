import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [zipcode] = process.argv.slice(2);
if (!/^\d{5}-?\d{3}$/.test(zipcode ?? '')) throw Error('Supply a test CEP.');
const retailer = 'paguemenos';
const ten = 'paracetamol da Medquímica, 750 mg, caixa de 10 comprimidos';
const client = new Client({name:'manufacturer-pack-check', version:'1'});
const remote = process.env.FARMACIAS_TEST_URL;
const transport = remote ? new StreamableHTTPClientTransport(new URL(remote)) :
  new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]});
try {
  await client.connect(transport);
  async function call(name, args) {
    const response = await client.callTool({name, arguments:{retailer,...args}}, undefined, {timeout:120000});
    assert.ok(!response.isError, name);
    return response.structuredContent;
  }
  const facts = await call('pharmacy_info',{queries:[ten]});
  const card = facts.results[0].products.find(p => p.manufacturer === 'Medquímica' &&
    p.activeIngredients.some(i => i.toLowerCase() === 'paracetamol') && p.packs.some(p => /^10\s*(?:un|comprimido)/i.test(p)));
  assert.ok(card, 'catalog should identify the published ten-tablet product by name');
  const match = await call('pharmacy_compare',{query:ten,includeGenerics:false});
  assert.ok(match.products.some(p => p.sku === card.sku));
  for (const [query,dose,count] of [['paracetamol Medquímica 750 mg 20 comprimidos',750,20],
    ['paracetamol Medquímica 500 mg 10 comprimidos',500,10]]) {
    const check = await call('pharmacy_compare',{query,includeGenerics:false});
    assert.ok(['matches','no_match','incomplete_presentation','choose_reference'].includes(check.status),check.status);
    for (const p of [...(check.products ?? []),...(check.candidates ?? [])]) {
      assert.notEqual(p.sku,card.sku);
      assert.equal(p.manufacturer,'Medquímica');
      assert.match(p.name,new RegExp('\\b'+dose+'\\s*mg\\b','i'));
      assert.match(p.name,new RegExp('\\b'+count+'\\s*comprimidos?\\b','i'));
    }
  }
  const plan = await call('plan_purchase',{items:[{query:'paracetamol 750 mg 10 comprimidos',brand:'Medquímica',includeGenerics:false}],origin:{zipcode}});
  const product = (plan.products ?? plan.tables?.[0]?.choices ?? []).find(p => p.sku === card.sku);
  assert.ok(product, 'checkout should quote the same named manufacturer');
  assert.equal(product.manufacturer, card.manufacturer);
  assert.equal(product.branchQuantity,null);
  assert.ok(['available','unavailable','unverified'].includes(product.localStatus),product.localStatus);
  console.log(JSON.stringify({version:client.getServerVersion().version, name:card.name, manufacturer:card.manufacturer,
    packs:card.packs, ingredient:card.activeIngredients, compositionSource:card.ingredientEvidence?.source,
    mismatchedPresentationsExcluded:2,localStatus:product.localStatus,
    pickupOffered:product.methods.some(m=>m.channel==='pickup-in-point' && m.pickupPointId)}));
} finally {await client.close();}
