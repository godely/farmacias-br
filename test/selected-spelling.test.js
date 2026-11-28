import test from 'node:test';
import assert from 'node:assert/strict';
import {searchCatalog,suggestTerms} from '../src/index.js';
import {catalogReply,toolReply} from '../src/server.js';
import {withDrogasilNames} from '../src/drogasil-names.js';

const ids=['drogasil','paguemenos','drogariasaopaulo'];
for(let mask=1;mask<8;mask++) {
  const retailers=ids.filter((_,index)=>mask & (1<<index));
  test('confirm and decline retain the selected chains: '+retailers.join(', '),async()=>{
    const calls=[];
    const sources=Object.fromEntries(ids.map(id=>[id,{
      async search(q){calls.push(id);return q==='morfina'?[{sku:'1',name:'Dimorf'}]:[];},
      async suggest(){calls.push(id);return ['morfina','morfina 10 mg'];},
    }]));
    const args={query:'morfi',retailers};
    const initial=toolReply('search',args,await searchCatalog(args,sources)).structuredContent;
    assert.equal(initial.reply,'Você quis dizer morfina?');
    assert.equal(initial.interaction,'awaiting_confirmation');
    assert.deepEqual(initial.confirmation.onYes.retailers,retailers);
    assert.deepEqual(initial.confirmation.onNo.retailers,retailers);
    const yes=await searchCatalog(initial.confirmation.onYes,sources);
    assert.deepEqual(yes.results.map(r=>r.products.length),retailers.map(()=>1));
    const declined=initial.confirmation.onNo;
    const no=catalogReply('suggest',declined,await suggestTerms(declined,sources));
    assert.deepEqual(no.suggestions,['morfina 10 mg']);
    assert.equal(no.confirmation,undefined);
    assert.deepEqual(no.results.map(r=>r.retailerId),retailers);
    assert.deepEqual([...new Set(calls)],retailers);
  });
}
test('conflicting suggestions and real literal products do not become a shared correction',()=>{
  const groups=[{retailerId:'drogasil',suggestions:['x']},{retailerId:'paguemenos',suggestions:['y']}];
  assert.equal(catalogReply('search',{query:'q'},{results:groups}).confirmation,undefined);
  assert.equal(catalogReply('search',{query:'q'},{results:[{...groups[0],products:[{sku:'1'}]},groups[1]]}).confirmation,undefined);
});
test('Drogasil confirms the name and verifies the composition of a returned candidate',async()=>{
  const product=(sku,name,ingredient)=>({sku,name,details:{activeIngredientDescriptionList:[ingredient]}});
  const source={search:async q=>q==='sabonete'?[{sku:'s',name:'Sabonete neutro'}]:[{name:'Dimorf'},{name:'Revia'}]};
  const intent=async q=>q==='morfina'?{name:q,kind:'ingredient',suggestions:[],suffix:''}:
    {name:q,kind:'text',suggestions:['morfina'],suffix:''};
  const provider=withDrogasilNames(source,p=>({sku:p.sku,name:p.name}),intent,async()=>({hits:[
    product('1','Dimorf','Sulfato de morfina'),product('2','Outros usos para morfina','Naltrexona')]}));
  assert.deepEqual(await provider.search('morfi'),[]);
  assert.equal((await provider.search('sabonete'))[0].sku,'s');
  const rows=await provider.search('morfina');
  assert.deepEqual(rows.map(r=>r.sku),['1']);
  assert.equal(rows[0].ingredientEvidence.source,'retailer_field');
});
