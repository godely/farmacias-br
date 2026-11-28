// Exercise the installed executables and the running MCP without sending an origin.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const run = promisify(execFile);
const queries = ['Dimorf em gotas', 'Patz GTS em gotas, frasco de 20 mL', 'Rivotril em gotas',
  'Dimorf em gotas, frasco de 30 mL', 'Patz GTS em gotas 30 mg/mL','Rivotril sublingual',
  'Rivotril sublingual 2 mg','Rivotril sublingual 0,25 mg 60 comprimidos'];
const packages = ['drogasil','paguemenos','drogariasaopaulo'];
const client = new Client({name:'drop-presentation-facts', version:'1'});
const endpoint = process.env.FARMACIAS_TEST_MCP_URL;
const transport = endpoint ? new StreamableHTTPClientTransport(new URL(endpoint)) :
  new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]});
function verify(retailer,results) {
  assert.deepEqual(results.map(row => row.query),queries);
  for (const [i,row] of results.entries()) {
    if (row.query === 'Rivotril sublingual') {
      assert.equal(row.status,'matches',retailer);
      assert.ok(row.products.length);
      for (const p of row.products) {
        assert.match(p.name,/^rivotril\b/i);
        assert.match([p.form,...p.forms ?? []].join(' '),/sublingua(?:l|is)/i);
        assert.match([p.pack,...p.packs ?? []].join(' '),/30\s+comprimidos?/i);
        assert.match((p.strengths ?? p.ingredients.map(a=>a.strength)).join(' '),/0[.,]25\s*mg/i);
        assert.deepEqual(p.routes ?? [p.route],['Sublingual']);
        assert.ok(p.source);
        for (const key of ['currentPrice','referencePriceBRL','inStock']) assert.ok(!(key in p));
      }
      continue;
    }
    if (i >= 3 || (i === 0 && retailer === 'paguemenos' && !row.products.length)) {
      assert.ok(['no_reference','no_match'].includes(row.status));
      assert.equal(row.products.length,0);
      continue;
    }
    assert.equal(row.status,'matches',retailer + ' ' + row.query);
    assert.ok(row.products.length);
    for (const p of row.products) {
      const dose = (p.strengths ?? p.ingredients.map(a => a.strength)).join(' ').replace(/\s/g,'').replace(',', '.').toLowerCase();
      assert.ok(dose.includes(i === 2 ? '2.5mg/ml' : '10mg/ml'),dose);
      assert.match(p.name, [/dimorf/i,/patz/i,/rivotril/i][i]);
      assert.match([p.form,...p.forms ?? []].join(' '),/gotas?/i);
      assert.match([p.pack,...p.packs ?? []].join(' '),i === 0 ? /60\s*ml/i : /20\s*ml/i);
      for (const key of ['currentPrice','referencePriceBRL','onlineStockSignal','inStock']) assert.ok(!(key in p));
      assert.ok(p.source);
      if (i === 0) {
        assert.equal(p.prescription.form,'Notificação de Receita A');
        assert.equal(p.prescription.list,'A1');
        assert.match(p.prescription.rule,/anvisalegis/);
        assert.ok(!(p.prescriptionLabel ?? []).join(' ').includes('C1'));
      }
    }
  }
}
try {
  await client.connect(transport);
  for (const retailer of packages) {
    const local = import.meta.resolve(retailer + '-cli');
    const bin = fileURLToPath(new URL(retailer === 'drogasil' ? '../../bin/drogasil.js' : './cli.js',local));
    let output;
    try { output = await run(process.execPath,[bin,'info',...queries,'--json']); }
    catch (error) { if(error.code !== 3) throw error; output = error; }
    const cli = JSON.parse(output.stdout);
    verify(retailer,cli.results);
    const reply = await client.callTool({name:'pharmacy_info',arguments:{retailer,queries}},undefined,{timeout:120000});
    assert.ok(!reply.isError);
    const mcp = reply.structuredContent;
    verify(retailer,mcp.results);
    assert.deepEqual(mcp.results.map(row => row.products.map(p => p.sku)),cli.results.map(row => row.products.map(p => p.sku)));
    console.log(retailer + ': CLI and MCP agree on all ' + queries.length + ' presentation requests');
  }
} finally { await client.close(); }
