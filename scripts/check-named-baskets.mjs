// Live retailer check. Supply two test origins at run time; do not save them in reports.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const origins=process.argv.slice(2);
if(origins.length!==2 || !origins.every(s=>/^\d{5}-?\d{3}$/.test(s))) throw Error('Supply two test CEPs.');
const execute=promisify(execFile);
const binary=name=>fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));
const chains=['drogasil','paguemenos','drogariasaopaulo'];
const queries=['Patz GTS em gotas, frasco de 20 mL','Frontal 2 mg 30 comprimidos de liberação imediata'];
const knownDrops={drogasil:'913628',paguemenos:'126484',drogariasaopaulo:'845841'};
const client=new Client({name:'farmacias-basket-check',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[binary('server')]});

function verify(data,retailers) {
  assert.equal(data.scope,'whole_basket_per_retailer');
  assert.deepEqual(data.results.map(r=>r.retailerId),retailers);
  for(const row of data.results) {
    assert.ok(row.status!=='source_failed',row.retailerId+' source failed');
    assert.deepEqual(row.tables.map(t=>t.label),['A','B']);
    const [drops,tablets]=row.tables;
    const skus=drops.requestedBrandSkus ?? drops.choices.map(p=>p.sku);
    assert.ok(skus.map(String).includes(knownDrops[row.retailerId]),row.retailerId+' drops presentation changed');
    if (row.retailerId==='drogasil') {
      assert.ok(tablets.requestedBrandSkus.includes('88262'));
      assert.ok(row.coverage.checkedStores>0);
    }
    if (row.retailerId==='paguemenos' && tablets.status==='no_match') {
      assert.equal(row.status,'partial');
      assert.equal(row.estimatedProductTotalBRL,null);
      assert.deepEqual(row.partialQuote.labels,['A']);
      assert.ok(row.partialQuote.items.some(p=>p.sku===knownDrops.paguemenos));
    }
    if (row.status==='choose_products') {
      assert.ok(row.pending.some(p=>p.status==='choose_product' && row.tables.find(t=>t.label===p.label)?.choices.length));
    }
  }
}

try {
  await client.connect(transport);
  const call=async args=>{
    const result=await client.callTool({name:'plan_purchase',arguments:args},undefined,{timeout:180000});
    assert.ok(!result.isError,'plan_purchase returned a tool error');
    return result.structuredContent;
  };
  for(let mask=1;mask<8;mask++) {
    const retailers=chains.filter((_,i)=>mask & (1<<i));
    const origin={zipcode:origins[(mask-1)%2]};
    const items=queries.map(query=>({query,includeGenerics:false}));
    const consent=await call({origin,retailers,items:[items[0],{query:'Frontal'}]});
    assert.equal(consent.status,'needs_generic_preference');
    assert.deepEqual(consent.pendingBrands.map(p=>p.label),['B']);
    assert.deepEqual(consent.results,[]);
    const direct=await call({origin,retailers,items});
    verify(direct,retailers);
    const {stdout}=await execute(process.execPath,[binary('farmacias'),'plan',...queries,'--retailers',retailers.join(','),
      '--brand-only','A','--brand-only','B','--cep',origin.zipcode,'--json'],{maxBuffer:8*1024*1024,timeout:180000});
    verify(JSON.parse(stdout),retailers);
    console.log(retailers.join('+'),'CLI and MCP verified');
  }
} finally { await client.close(); }
