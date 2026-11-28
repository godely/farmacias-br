import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchCatalog, schemas, suggestTerms} from '../src/index.js';
import {planSelectedBaskets, purchaseSchema} from '../src/named-baskets.js';
import {nameChoices} from '../src/name-choices.js';
import {toolReply} from '../src/server.js';

const ids = ['drogasil', 'paguemenos', 'drogariasaopaulo'];
const names = ['prednisona', 'prednisolona'];
test('two distinct ingredient names remain valid choices when the live name index fails', async () => {
  for (const resolve of [async () => ({kind:'ingredient'}), async () => { throw Error('offline'); }]) {
    const result = await nameChoices('predniso 20 mg', {resolve, intentFor:async () => ({
      name:'predniso', suffix:'20 mg', suggestions:names.map(name => name + ' 20 mg'),
    })});
    assert.deepEqual(result, names.map(name => name + ' 20 mg'));
  }
  const common = await nameChoices('gel', {intentFor:async () => ({name:'gel',suffix:'',suggestions:['gelmax']})});
  assert.deepEqual(common, []);
});

for (let mask = 1; mask < 8; mask++) {
  const retailers = ids.filter((_, index) => mask & (1 << index));
  const scope = retailers.length === 1 ? {retailer:retailers[0]} : {retailers};
  test('catalog identity and yes/no choices retain scope: ' + retailers.join(', '), async () => {
    const searches = [];
    const sources = Object.fromEntries(ids.map(id => [id, {
      search:async query => { searches.push([id, query]); return [{name:query}]; },
      suggest:async () => ['morfina', 'outro termo'],
    }]));
    const clarify = async query => query === 'morfi' ? ['morfina'] : query === 'predniso' ? names : [];
    const ask = async query => {
      const args = {query, ...scope, limit:5};
      return toolReply('search', args, await searchCatalog(args, sources, clarify)).structuredContent;
    };
    const ambiguous = await ask('predniso');
    assert.equal(ambiguous.reply, 'Você quis dizer prednisona ou prednisolona?');
    assert.equal(ambiguous.confirmation, undefined);
    assert.deepEqual(ambiguous.nameChoice.options[1].onSelect, {query:'prednisolona', limit:5, ...scope});
    const first = await ask('morfi');
    assert.equal(first.reply, 'Você quis dizer morfina?');
    assert.deepEqual(searches, []);
    const next = first.confirmation;
    const other = await suggestTerms(schemas.suggest.parse(next.onNo), sources);
    assert.deepEqual(other.suggestions,['outro termo']);
    await searchCatalog(next.onYes, sources, clarify);
    assert.deepEqual(searches, retailers.map(id => [id,'morfina']));
  });
  test('basket clarification preserves each preference and pack before any retail lookup: ' + retailers.join(', '), async () => {
    const args = purchaseSchema.parse({...scope, origin:{latitude:0, longitude:0}, items:[
      {query:'Produto', quantity:2, includeGenerics:false}, {query:'predniso 20 mg', quantity:3, genericOnly:true},
    ]});
    let plans = 0;
    const plan = async () => { plans++; throw Error('Unexpected shopping call'); };
    const result = await planSelectedBaskets(args, {plan, resolve:assert.fail, clarify:async query =>
      query.startsWith('predniso ') ? names.map(name => name + ' 20 mg') : []});
    assert.equal(plans, 0);
    const reply = toolReply('plan_purchase', args, result).structuredContent;
    assert.equal(reply.nextTool,'plan_purchase');
    const next = reply.nameChoice.options[1].onSelect;
    assert.deepEqual(next,{...args,items:[args.items[0], {...args.items[1],query:'prednisolona 20 mg'}]});
    assert.deepEqual(purchaseSchema.parse(next), next);
  });
}

test('a title can supply a missing ingredient while a conflicting catalog field vetoes it', async () => {
  const {withMedicationNames} = await import('../src/providers.js');
  const adapter = withMedicationNames({search:async () => [
    {name:'Prednisona 20mg 10 comprimidos', facts:{NomeSubstanciaPrincipioAtivo:['Antimicrobiano']}},
    {name:'Prednisona', facts:{NomeSubstanciaPrincipioAtivo:['Prednisolona']}},
    {name:'Xarope sem prednisona'},
    {name:'Produto da marca', facts:{NomeSubstanciaPrincipioAtivo:['Prednisona']}},
  ]}, assert.fail, async () => ({kind:'ingredient', name:'prednisona', suffix:''}));
  const hits = await adapter.searchCatalog('prednisona',1,10);
  assert.deepEqual(hits.map(hit => hit.ingredientEvidence.source), ['retailer_title','retailer_field']);
  assert.deepEqual(hits.map(hit => hit.activeIngredients[0].toLowerCase()), ['prednisona','prednisona']);
});

test('an explicit choice resumes its originating tool and preserves other factual queries and location options', async () => {
  const {clarifyLookup} = await import('../src/name-choices.js');
  const queries = ['Rivotril', 'predniso'];
  const clarify = async term => term === 'predniso' ? names : [];
  for (const tool of ['get_medication_info','pharmacy_info','search_products','compare_products','pharmacy_prices','pharmacy_compare']) {
    const info = tool.includes('info');
    const args = info ? {queries, scope:'brazil'} : {query:'predniso', origin:{latitude:0, longitude:0}, includeGenerics:false};
    const value = await clarifyLookup(tool, args, {retailer:'drogasil'}, clarify);
    const reply = toolReply(tool, args, value).structuredContent;
    assert.equal(reply.reply,'Você quis dizer prednisona ou prednisolona?');
    assert.equal(reply.nextTool,tool);
    assert.deepEqual(reply.nameChoice.options[0].onSelect, info ? {...args,queries:['Rivotril','prednisona']} : {...args,query:'prednisona'});
    const one = await clarifyLookup(tool, args, {retailer:'drogasil'}, async term => term==='predniso' ? ['prednisona'] : []);
    assert.deepEqual(one.confirmation.onNo,{query:'predniso',retailer:'drogasil',declinedTerm:'prednisona'});
    assert.equal(one.confirmation.onYesTool,tool);
  }
});
