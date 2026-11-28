// A live release check. Pass the test origin and expected retailer set explicitly.
// Optional FARMACIAS_TEST_MCP_URL selects the deployed server.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [zipcode, scope, surface='both'] = process.argv.slice(2);
const retailers = (scope ?? '').split(',');
const ids=['drogasil','paguemenos','drogariasaopaulo'];
assert.match(zipcode ?? '',/^\d{5}-?\d{3}$/,'Informe um CEP de teste');
assert.ok(retailers.every(id=>ids.includes(id)) && new Set(retailers).size===retailers.length);
assert.ok(['cli','mcp','both'].includes(surface));
const items=[
  ['Dimorf em gotas','Dimorf'],
  ['Pro Soro Dauf 500 mL','Dauf'],
  ['Ever Care spray nasal','Ever Care'],
  ['Patz GTS em gotas, frasco de 30 mL','Patz'],
].map(([query,brand])=>({query,brand,includeGenerics:false}));
const args={origin:{zipcode},retailers,items};
const file = name => fileURLToPath(new URL('../bin/'+name+'.js',import.meta.url));

function verify(result,label) {
  assert.deepEqual(result.checkedRetailers,retailers);
  const basket=result.crossRetailerPlans ?? result.results[0].pickupPlans;
  assert.equal(basket.status,'no_complete_plan_verified');
  assert.deepEqual(basket.plans,[]);
  const partial=basket.partialBasket;
  assert.equal(partial.requestedCount,4);
  assert.ok(partial.filledCount>0 && partial.filledCount<4,'A consulta precisa confirmar pelo menos uma retirada');
  assert.ok(partial.plans.length);
  for(const p of partial.plans) {
    const filled=new Set();
    for(const stop of p.stops) {
      assert.ok(retailers.includes(stop.retailerId) && stop.id);
      for(const pick of stop.pickups) {
        assert.ok(!filled.has(pick.item) && pick.item>=0 && pick.item<3);
        assert.match(pick.name,[/dimorf/i,/dauf.*pro soro/i,/ever\s*care/i][pick.item]);
        if(pick.item===0) assert.match(pick.name,/solu[çc][aã]o|gotas/i);
        if(pick.evidence==='reported_branch_stock') assert.ok(pick.reportedStock>=pick.packs);
        else {assert.equal(pick.evidence,'quoted_pickup');assert.equal(pick.reportedStock,null);}
        filled.add(pick.item);
      }
    }
    assert.equal(filled.size,partial.filledCount);
    // Release fixture at the caller's pilot location. A changed assortment
    // should prompt a retailer recheck instead of passing a catalog regression.
    const expected = [
      retailers.includes('drogasil') || retailers.includes('drogariasaopaulo'),
      retailers.includes('paguemenos'), retailers.includes('drogariasaopaulo'),
    ].flatMap((present,i)=>present?[i]:[]);
    assert.deepEqual([...filled].sort(),expected,'A oferta mudou ou o nome deixou de ser reconhecido');
    assert.deepEqual(p.unfilled.map(line=>line.item),items.flatMap((_,i)=>filled.has(i)?[]:[i]));
    for(const line of p.unfilled) assert.deepEqual(line.outcomes.map(o=>o.retailerId),retailers);
    assert.ok(p.unfilled.find(line=>line.item===3));
  }
  console.log(label,scope,partial.filledCount+'/4',partial.plans.map(p=>p.stopCount+' stop(s), R$ '+p.totalBRL).join(' / '));
}

if(surface!=='mcp') {
  const flags=items.flatMap((item,i)=>['--brand',String.fromCharCode(65+i)+'='+item.brand,'--brand-only',String.fromCharCode(65+i)]);
  const {stdout}=await promisify(execFile)(process.execPath,[file('farmacias'),'plan',...items.map(i=>i.query),
    '--cep',zipcode,'--retailers',scope,...flags],{timeout:240000,maxBuffer:32000000});
  verify(JSON.parse(stdout),'CLI');
}
if(surface!=='cli') {
  const client=new Client({name:'partial-basket-release-check',version:'1'});
  try {
    const url=process.env.FARMACIAS_TEST_MCP_URL;
    await client.connect(url ? new StreamableHTTPClientTransport(new URL(url)) :
      new StdioClientTransport({command:process.execPath,args:[file('server')]}));
    const response=await client.callTool({name:'plan_purchase',arguments:args},undefined,{timeout:240000});
    assert.ok(!response.isError);
    assert.equal(response.structuredContent.nextAction,'answer_with_partial_basket');
    assert.match(response.content[0].text,/Cesta parcial/);
    verify(response.structuredContent,'MCP '+client.getServerVersion().version);
  } finally {await client.close();}
}
