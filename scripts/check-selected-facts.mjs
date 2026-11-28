// Opt-in live acceptance without a shopper location or shopping lookups.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const run = promisify(execFile);
const entry = name => fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));
const ids = ['drogasil','paguemenos','drogariasaopaulo'];
const queries = ['Rivotril', 'tansulosina Eurofarma'];
const client = new Client({name:'selected-facts-check',version:'1'});
const endpoint = process.env.FARMACIAS_TEST_MCP_URL;
const transport = endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
  new StdioClientTransport({command:process.execPath,args:[entry('server')]});

function verify(data, retailers) {
  assert.equal(data.status,'checked');
  assert.deepEqual(data.results.map(x=>x.retailerId),retailers);
  for (const group of data.results) {
    assert.deepEqual(group.results.map(row=>row.query),queries);
    const [brand, ingredient] = group.results;
    for (const row of [brand,ingredient]) {
      assert.equal(row.status,'matches',group.retailerId);
      for (const item of row.products) {
        for (const field of ['referencePriceBRL','currentPrice','inStock','branchQuantity']) assert.ok(!(field in item));
        assert.ok(item.source);
      }
    }
    assert.ok(brand.products.every(p=>/\brivotril\b/i.test(p.name)));
    assert.ok(brand.products.some(p=>/sublingua/i.test([p.form,...p.forms??[]].join(' '))));
    assert.ok(brand.products.some(p=>/2[,.]5\s*mg\s*\/\s*ml/i.test(
      [...p.strengths??[],...p.ingredients?.map(i=>i.strength)??[]].join(' '))));
    assert.ok(ingredient.products.length);
    for (const p of ingredient.products) {
      assert.match([p.name,...p.activeIngredients??[],...p.ingredients?.map(i=>i.name)??[]].join(' '),/\btansulosina\b/i);
      assert.equal(p.manufacturer?.toLowerCase(),'eurofarma');
      assert.ok(p.manufacturerSource);
      assert.doesNotMatch(p.name,/\b(biolab|bicalutamida)\b/i);
      assert.ok([true,false,null].includes(p.prescription.required));
      assert.ok([true,false,null].includes(p.prescription.retained));
      if (group.retailerId === 'paguemenos') {
        assert.match(p.activeIngredients.join(' '),/cloridrato de tansulosina/i);
        assert.equal(p.ingredientEvidence.source,'retailer_composition');
        assert.equal(p.prescriptionEvidence.url,p.source);
        assert.deepEqual([p.prescription.required,p.prescription.retained],[true,false]);
      }
    }
  }
}

let failures = 0;
try {
  await client.connect(transport);
  for (const id of ids) {
    const bin = fileURLToPath(new URL('../node_modules/.bin/'+id,import.meta.url));
    const {stdout} = await run(process.execPath,[bin,'info',...queries],{timeout:180000,maxBuffer:4*1024*1024});
    assert.match(stdout,/Via: Sublingual/i,id);
    assert.match(stdout,/2[,.]5\s*mg\s*\/\s*ml/i,id);
    assert.match(stdout,/Embalagem: [^\n]*20\s*ml/i,id);
    assert.match(stdout,/Fabricante: Eurofarma/i,id);
    assert.match(stdout,/Princípios ativos: [^\n]*tansulosina/i,id);
    assert.match(stdout,/Precisa de receita\? [^\n]*A farmácia retém\? [^\n]*Qual receituário\?/i,id);
    assert.doesNotMatch(stdout,/R\$|\bSKU\b|\bCEP\b/iu,id);
    console.log('PASS standalone info',id);
  }
  for (const mask of [1,2,4,3,5,6,7]) {
    const retailers = ids.filter((_,i)=>mask & (1<<i));
    for (const surface of ['cli','mcp']) {
      try {
        let data;
        if (surface === 'cli') {
          const r = await run(process.execPath,[entry('farmacias'),'info',...queries,'--retailers',retailers.join(','),'--limit','10'],
            {maxBuffer:4*1024*1024,timeout:180000});
          data = JSON.parse(r.stdout);
        } else {
          const r = await client.callTool({name:'pharmacy_info',arguments:{queries,retailers,limit:10}},undefined,{timeout:180000});
          assert.ok(!r.isError);
          data = r.structuredContent;
        }
        verify(data,retailers);
        console.log('PASS',surface,retailers.join('+'));
      } catch (err) {
        failures++;
        console.error('FAIL',surface,retailers.join('+'),err.message);
      }
    }
  }
} finally { await client.close(); }
if (failures) process.exitCode=1;
