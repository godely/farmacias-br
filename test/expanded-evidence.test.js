import assert from 'node:assert/strict';
import test from 'node:test';
import {expandedBranches} from '../src/stock-coverage.js';
import {shoppingReply, toolReply} from '../src/server.js';

const branch = (id, address, distanceKm=1) => ({
  id:String(id), name:'FILIAL '+id, address, distanceKm, stocks:[{sku:'42',quantity:1}],
});
const window = (id, stores, total, extra={}) => ({retailerId:id,
  expandedSearch:{radiusKm:25,checkedStores:40,partial:false,stores,totalStockedStores:total,...extra}});

test('the displayed ten branches preserve published address fields and the full matching count',()=>{
  const address={addressLocal:'Rua das Flores',addressNumber:'14 A',district:'JD. A',city:'Exemplo',sgState:'SP'};
  const list=Array.from({length:10},(_,i)=>branch(i,address,i+1));
  const other=branch(1,{street:'Rua B',number:'0',neighborhood:'Vl. X',city:'Exemplo',state:'SP'},0.2);
  const expanded=expandedBranches([window('drogasil',list,13),window('paguemenos',[other],1)]);
  assert.equal(expanded.stores.length,10);
  assert.equal(expanded.checkedStores,80);
  assert.equal(expanded.totalStockedStores,14);
  assert.equal(expanded.stores[0].publishedAddress,'Rua B, 0, Vl. X, Exemplo - SP');
  assert.equal(expanded.stores[1].publishedAddress,'Rua das Flores, 14 A, JD. A, Exemplo - SP');
  const {content,structuredContent}=shoppingReply(toolReply('plan_purchase',{},{
    expandedSearch:expanded,checkedRetailers:['drogasil','paguemenos'],scope:'whole_basket_per_retailer',results:[]}));
  assert.equal(structuredContent.expandedSearch.totalStockedStores,14);
  assert.match(content[0].text,/14 filiais/);
  assert.match(content[0].text,/10 mais próximas/);
  assert.match(content[0].text,/JD\. A, Exemplo - SP/);
  assert.doesNotMatch(content[0].text,/resultados locais/);
});

test('a partial or inconsistent window cannot yield a definitive stocked count',()=>{
  for (const raw of [window('drogasil',[branch(1,null)],2,{partial:true}),
                     window('drogasil',[branch(1,null,26)],1),
                     window('drogasil',[branch(1,null)],0)]) {
    const result=expandedBranches([raw]);
    assert.equal(result.totalStockedStores,null);
    const {content}=shoppingReply(toolReply('plan_purchase',{}, {expandedSearch:result,results:[]}));
    assert.match(content[0].text,/confirmad/i);
    assert.doesNotMatch(content[0].text,/estoque zero|todas sem estoque/i);
  }
});

test('a zero-only chain that checked a wider area contributes zero matches but no in-radius branch count',()=>{
  const first=window('drogasil',[branch(1,undefined)],1);
  const other={retailerId:'paguemenos',coverage:{checkedStores:7,allZero:true,radiusKm:40}};
  const result=expandedBranches([first,other]);
  assert.equal(result.totalStockedStores,1);
  assert.equal(result.checkedStores,null);
  assert.equal(result.stores[0].publishedAddress,undefined);
});
