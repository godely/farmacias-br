import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { localApp, catalogReply, shoppingReply, toolReply } from '../src/server.js';
import { getStock, listRetailers, request, searchCatalog as runCatalogSearch, suggestTerms } from '../src/index.js';
import { observations } from '../src/monitoring.js';

// These fixtures exercise provider suggestions after the shared name check.
const searchCatalog = (args, sources) => runCatalogSearch(args, sources, async () => []);

test('one source outage leaves separate catalog outcomes and preserves retailer-specific SKU identity', async () => {
  const sources = Object.fromEntries(listRetailers().map(({id}) => [id, { search: async () => [{sku: '1', name: 'Exemplo Genérico'}] }]));
  sources.paguemenos.search = async () => { throw Error('outage'); };
  sources.drogariasaopaulo.search = async () => [];
  const result = await searchCatalog({query:'exemplo'}, sources);
  assert.deepEqual(result.results.map(group=>group.status), ['matches','source_failed','no_match']);
  assert.deepEqual(result.results.flatMap(group=>group.products).map(p=>[p.retailerId,p.sku,p.type]),
    [['drogasil','1','Genérico']]);
});

test('missing coverage, unknown SKU, seller failure and stock bands are distinct', async () => {
  const row = {sku:'31', name:'Produto'}; const options = {retailer:'paguemenos',sku:'31',zipcode:'01001000',quantity:3};
  const provider = {serves:async()=>false, product:async()=>assert.fail()};
  const sources = {paguemenos:provider};
  assert.equal((await getStock(options,sources)).status, 'outside_local_directory');
  provider.serves = async()=>true; provider.product = async()=>[];
  assert.equal((await getStock(options,sources)).status,'unknown_sku');
  provider.product = async()=>[row]; provider.local = async()=>{throw Error('stock outage')};
  assert.equal((await getStock(options,sources)).status,'source_failed');
  provider.local = async(_r,_z,q)=>({...row,quantityVerified:false,requestedQuantity:q,branches:[{reportedStock:'baixo'}]});
  const [a] = (await getStock(options,sources)).offers;
  assert.equal(a.quantityVerified,false); assert.equal(a.requestedQuantity,3);
  assert.equal(a.branches[0].quantity,undefined);
});

test('a Pague Menos prefix returns terms until the caller selects one, then exposes the catalog ingredient', async () => {
  const searched = [], suggested = [];
  const sources = { paguemenos: {
    search: async query => {
      searched.push(query);
      return query === 'morfina' ? [{ sku: '1', name: 'Dimorf', facts: { NomeSubstanciaPrincipioAtivo: ['Morfina'] } }] : [];
    },
    suggest: async query => { suggested.push(query); return ['MORFI', 'morfina']; },
  } };
  const args = { retailer: 'paguemenos', query: 'morfi' };
  const first = await searchCatalog(args, sources);
  const [group] = first.results;
  assert.deepEqual(group, { retailerId: 'paguemenos', status: 'no_match', products: [],
    suggestionStatus: 'suggestions', suggestions: ['morfina'] });
  assert.deepEqual(searched, ['morfi']);
  assert.equal(observations('pharmacy_search', args, first)[0].outcome, 'clarification');
  const chosen = await searchCatalog({ retailer: group.retailerId, query: group.suggestions[0] }, sources);
  assert.deepEqual(chosen.results[0].products[0].activeIngredients, ['Morfina']);
  assert.equal(chosen.results[0].suggestions, undefined);
  await searchCatalog({ ...args, page: 2 }, sources);
  assert.deepEqual(suggested, ['morfi']);
  const terms = await suggestTerms({query: 'morfi'}, sources);
  assert.ok(terms.suggestions.includes('morfina'));
  assert.deepEqual(searched, ['morfi', 'morfina', 'morfi']);
  assert.equal((await suggestTerms({...args, retailer:'drogasil'}, {drogasil:sources.paguemenos})).status, 'suggestions');
});

test('a suggestion outage preserves the catalog miss, and a failed catalog does not initiate suggestions', async () => {
  const args = { retailer: 'paguemenos', query: 'exemplo' };
  let calls = 0;
  const provider = { search: async () => [], suggest: async () => { calls++; throw Error('outage'); } };
  const sources = { paguemenos: provider };
  const first = await searchCatalog(args, sources);
  assert.deepEqual(first.results[0], { retailerId:'paguemenos', status:'no_match', products:[],
    suggestionStatus:'source_failed', suggestions:[] });
  assert.equal(observations('pharmacy_search', args, first)[0].outcome, 'upstream_failure');
  provider.search = async () => { throw Error('outage'); };
  assert.equal((await searchCatalog(args, sources)).results[0].status, 'source_failed');
  assert.equal(calls, 1);
});

test('MCP exposes one question, routes yes to the named retailer and excludes the declined term on no', async () => {
  for (const [query, term] of [['morfi','morfina'], ['ibuporfeno','ibuprofeno'], ['loartadina','loratadina']]) {
    const args = {query, retailer:'paguemenos'};
    let ranking = [term, term+' 10mg', term+' gotas'];
    const sources = {paguemenos: {search: async q => q === term ? [{name:term, sku:'1'}] : [], suggest: async () => ranking}};
    const raw = await searchCatalog(args, sources);
    const [group] = catalogReply('search', args, raw).results;
    assert.deepEqual(group.suggestions, [term]);
    assert.deepEqual(group.products, []);
    assert.equal(group.confirmation.question, 'Você quis dizer '+term+'?');
    assert.equal(JSON.stringify(group).includes('gotas'), false);
    assert.equal((await searchCatalog(group.confirmation.onYes, sources)).results[0].status, 'matches');
    assert.deepEqual(catalogReply('suggest', args, await suggestTerms(args,sources)).suggestions, [term]);
    assert.deepEqual(catalogReply('suggest', {...args,listAll:true}, await suggestTerms(args,sources)).suggestions, ranking);
    ranking = [term+' gotas', term.toUpperCase(), query, term+' 10mg'];
    const no = group.confirmation.onNo;
    assert.deepEqual(catalogReply('suggest', no, await suggestTerms(no,sources)), {
      retailerId:'paguemenos', status:'no_suggestions', suggestions:[] });
    ranking = [term];
    assert.equal((await suggestTerms(no, sources)).status, 'no_suggestions');
    ranking = [];
    assert.equal(catalogReply('search', args, await searchCatalog(args,sources)).results[0].confirmation, undefined);
  }
});

test('bounded and strict public inputs', async () => {
  for (const [operation, input] of [
    ['constructor',{}],['search',{query:' '}],['search',{query:'x',limit:101}],['search',{query:'x',retailer:'other'}],
    ['stock',{retailer:'drogasil',sku:'1',zipcode:'00000-000'}],['stock',{retailer:'drogasil',sku:'1',zipcode:'01001000',quantity:-2}],
    ['product',{sku:'2'}],['retailers',{zipcode:'private'}],['prices',{query:'x',zipcode:'wrong'}],
  ]) await assert.rejects(request(operation,input));
});

test('CLI, HTTP, HTTP MCP and stdio MCP expose the same registry', async t => {
  const listener = localApp().listen(0,'127.0.0.1'); await once(listener,'listening');
  t.after(()=>listener.close());
  const url = 'http://127.0.0.1:'+listener.address().port;
  const cli = fileURLToPath(new URL('../bin/farmacias.js',import.meta.url));
  assert.deepEqual(JSON.parse(execFileSync(process.execPath,[cli,'retailers'])),listRetailers());
  assert.deepEqual(await (await fetch(url+'/api/v1/retailers')).json(),listRetailers());
  async function post(path, data, headers={}) {
    return fetch(url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
  }
  assert.equal((await post('/api/v1/prices', {query:'x'})).status,400);
  assert.equal((await post('/api/v1/constructor', {})).status,404);
  assert.equal((await post('/api/v1/retailers', {},{origin:'https://foreign.example'})).status,403);
  const readers = await Promise.all(Array.from({length:24},()=>fetch(url+'/api/v1/retailers').then(r=>r.json())));
  assert.ok(readers.every(data=>data.length===3));
  for (const transport of [new StreamableHTTPClientTransport(new URL(url+'/mcp')),
    new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))]})]) {
    const client = new Client({name:'integration',version:'1'}); await client.connect(transport);
    try {
      const {tools} = await client.listTools();
      assert.match(client.getInstructions(), /Accept a supplied SKU silently/);
      assert.ok(tools.every(tool => tool.description.includes('Never ask for, mention, or display a SKU')));
      const active=['drogasil','paguemenos','drogariasaopaulo'];
      assert.deepEqual(listRetailers().map(p=>p.id),active);
      for (const tool of tools) {
        const field=tool.inputSchema?.properties?.retailer;
        if (field?.enum) assert.ok(field.enum.every(id=>active.includes(id)));
      }
      for (const name of ['plan_purchase','find_nearby_stock','get_medication_info','compare_products','collect_catalog_snapshot','pharmacy_retailers','pharmacy_prices','pharmacy_search','pharmacy_suggest','pharmacy_stock','pharmacy_product','pharmacy_basket','pharmacy_compare','pharmacy_info','pharmacy_stores','pharmacy_snapshot','pharmacy_read_snapshot']) {
        assert.ok(tools.some(tool=>tool.name===name),name);
      }
      assert.equal(tools.find(t=>t.name==='pharmacy_snapshot').annotations.readOnlyHint,false);
      assert.equal(tools.find(t=>t.name==='pharmacy_basket').annotations.readOnlyHint,true);
      assert.deepEqual((await client.callTool({name:'pharmacy_retailers',arguments:{}})).structuredContent.retailers,listRetailers());
      assert.ok(tools.find(t=>t.name==='plan_purchase').inputSchema.properties.retailer);
      assert.ok(tools.find(t=>t.name==='pharmacy_compare').inputSchema.properties.store);
      assert.ok((await client.callTool({name:'pharmacy_compare',arguments:{retailer:'paguemenos',query:'produto',store:'nearest',includeGenerics:false}})).isError);
      assert.ok((await client.callTool({name:'pharmacy_stock',arguments:{sku:'1'}})).isError);
    } finally {await client.close()}
  }
});


test('a completed fixed-store checkout directs the client to answer without widening the search',()=>{
  const args={retailer:'paguemenos',store:'nearest'};
  const value={status:'pickup_not_offered',planningScope:'one_pack_alternatives',fixedStore:{branch:{id:'1'}},tables:[]};
  const result=shoppingReply(toolReply('plan_purchase',args,value));
  assert.equal(result.structuredContent.nextAction,'answer_for_selected_branch');
  assert.equal(result.structuredContent.storeScope,'fixed_branch');
  assert.equal(result.structuredContent.priceGuidance,undefined);
  assert.match(result.content[0].text,/encerre o turno/);
  assert.equal(toolReply('plan_purchase',{},value).structuredContent.nextAction,undefined);
});

test('coordinate-only origins reach the point-capable retailer and request a CEP for delivery quotes', async () => {
  const coordinates={latitude:-23.5,longitude:-46.6};
  const row={sku:'42',name:'Example'};
  const sources={drogasil:{product:async()=>[row],local:async(arg,origin)=>{assert.deepEqual(origin,coordinates);return arg}}};
  assert.equal((await getStock({retailer:'drogasil',sku:'42',coordinates},sources)).status,'checked');
  for(const retailer of ['paguemenos','drogariasaopaulo']) {
    assert.equal((await getStock({retailer,sku:'42',coordinates},{[retailer]:sources.drogasil})).status,'checked');
  }
  assert.equal((await request('prices',{query:'42',coordinates})).status,'requires_cep');
});

test('an independent name search can resolve a missing primary reference without selecting a near match', async () => {
  const {comparePrices} = await import('../src/index.js');
  const sources=Object.fromEntries(listRetailers().map(({id})=>[id,{search:async()=>[]}]));
  sources.paguemenos.search=async()=>[{sku:'9',name:'Exemplo gotas 20 mL'}];
  const args={query:'Exemplo gotas 30 mL',zipcode:'01001000'};
  for (const compare of [async()=>({status:'no_reference'}), async()=>{ throw Error('unavailable') }]) {
    const r=await comparePrices(args,{compare,sources});
    assert.equal(r.status,'choose_reference'); assert.equal(r.candidates[0].retailerId,'paguemenos');
    assert.ok(!r.verifiedOffers?.length);
  }
});

test('cross-retailer name evidence preserves the target catalog and presentation', async () => {
  const { withMedicationNames } = await import('../src/providers.js');
  const source = { suggest: async () => ['outra'], search: async q => q === 'paracetamol 500mg' ? [{sku:'local'}] : [] };
  const resolved = query => async () => ({kind:'ingredient', interpretation:{interpreted:query}});
  assert.deepEqual(await withMedicationNames(source,resolved('paracetamol 500mg')).suggest('acetaminophen 500mg'), ['paracetamol 500mg','outra']);
  assert.deepEqual(await withMedicationNames(source,resolved('paracetamol 750mg')).suggest('acetaminophen 750mg'), ['outra']);
  for (const unavailable of [async () => {throw Error('offline');}, async () => ({status:'ambiguous'})]) {
    assert.deepEqual(await withMedicationNames(source,unavailable).suggest('exemplo'), ['outra']);
  }
});

test('a full DCB prefix completion takes priority over a similar brand', async () => {
  const { withMedicationNames } = await import('../src/providers.js');
  const source = { suggest: async () => ['amoxil','amoxicilina'] };
  const resolve = async () => ({kind:'brand', interpretation:{interpreted:'amoxil'}});
  assert.deepEqual(await withMedicationNames(source,resolve).suggest('Amóxic', 1), ['amoxicilina']);
});

test('a text-only client gets the exact prompt and executable follow-ups', async () => {
  const args = {retailer:'paguemenos',query:'exem'};
  const res = toolReply('search', args, {results:[{retailerId:args.retailer, products:[], suggestions:['exemplo','exemplo 10mg']}]});
  assert.equal(res.structuredContent.reply, 'Você quis dizer exemplo?');
  assert.match(res.content[0].text, /pharmacy_suggest.*"declinedTerm":"exemplo"/);
  assert.match(res.content[0].text, /pharmacy_search.*"query":"exemplo"/);
  assert.ok(!JSON.stringify(res).includes('10mg'));
});

test('both partner chains keep the retailer on yes and ask it for alternatives on no', async () => {
  for (const retailer of ['paguemenos','drogariasaopaulo']) {
    const source = {search:async()=>[],suggest:async()=>['morfina'],
      alternatives:async(q,declined)=>{assert.equal(q,'morfi');assert.equal(declined,'morfina');return ['morfina 10 mg'];}};
    const args={query:'morfi',retailer};
    const group=catalogReply('search',args,await searchCatalog(args,{[retailer]:source})).results[0];
    assert.equal(group.confirmation.question,'Você quis dizer morfina?');
    assert.deepEqual(group.confirmation.onYes,{query:'morfina',retailer});
    const no=await suggestTerms(group.confirmation.onNo,{[retailer]:source});
    assert.deepEqual(no,{status:'no_suggestions',retailerId:retailer,suggestions:[]});
    const reply=toolReply('suggest',group.confirmation.onNo,no);
    assert.equal(reply.structuredContent.interaction,'awaiting_spelling');
    assert.match(reply.content[0].text,/outra parte do nome/);
  }
});

test('a partial alternatives lookup names only terms actually returned by the selected chains',async()=>{
  const args={query:'loratadnia',declinedTerm:'loratadina',retailers:['paguemenos','drogariasaopaulo']};
  const data=await suggestTerms(args,{paguemenos:{suggest:async()=>['loratadina xarope','desloratadina']},
    drogariasaopaulo:{suggest:async()=>{throw Error('offline');}}});
  assert.deepEqual(data.suggestions,['desloratadina']);
  const reply=toolReply('suggest',args,data).structuredContent;
  assert.equal(reply.interaction,'awaiting_alternative_name');
  assert.equal(reply.reply,'Parte das redes não respondeu. Encontrei desloratadina. Qual desses nomes aparece na caixa?');
});

test('directory outage, unknown item and insufficient local evidence have separate stock outcomes', async()=>{
  const args={retailer:'paguemenos',sku:'42',zipcode:'01001000'};
  for (const provider of [{serves:async()=>{throw Error('offline')}},{product:async()=>{throw Error('offline')}}]) {
    assert.equal((await getStock(args,{paguemenos:provider})).status,'source_failed');
  }
});

test('a broad counter question asks for one missing detail while preserving all catalog choices', () => {
  const names = ['Exemplo 750 mg 10 comprimidos', 'Exemplo 750 mg 20 comprimidos'];
  for (const table of [
    { status: 'presentation_options', candidates: names },
    { status: 'ambiguous', candidates: names },
    { status: 'choose_reference', choices: names },
  ]) {
    const tables = [table, { status: 'matches', rows: [{ name: 'Outro produto' }] }];
    const reply = shoppingReply({ structuredContent: { tables }, content: [] });
    assert.deepEqual(reply.structuredContent.tables, tables);
    assert.deepEqual(JSON.parse(reply.content[1].text), reply.structuredContent);
    assert.equal(reply.content[0].text, reply.structuredContent.presentationGuidance);
    assert.match(reply.content[0].text, /uma pergunta curta/);
  }
  for (const table of [
    { status: 'matches', rows: names }, { status: 'catalog_lookup_failed' },
    { status: 'ambiguous', nameCandidates: names }, { status: 'choose_reference', choices: [] },
  ]) {
    const original = { structuredContent: { tables: [table] }, content: [] };
    assert.equal(shoppingReply(original), original);
  }
});

test('known pickup and physical inventory give a price follow-up for the original item', () => {
  for (const data of [
    { coverage:{canExpand:false}, tables:[{lowestPricedStockedOption:'A1',rows:[{option:'A1',referencePriceBRL:5}]}] },
    { planningScope:'one_pack_alternatives', lowestPricedPickup:{currentPrice:5,branchQuantity:null} },
  ]) {
    const reply=shoppingReply({structuredContent:data,content:[]});
    assert.match(reply.structuredContent.priceGuidance,/comece pela opção disponível de menor preço/);
    assert.match(reply.content[0].text,/consulta inteira/);
    assert.deepEqual(JSON.parse(reply.content[1].text),reply.structuredContent);
  }
});

test('a pickup offer leaves reservation and readiness unconfirmed, including at a 24-hour store', () => {
  const offer = { branch: 'Loja 24 horas', channel: 'pickup-in-point', requestedQuantity: 1 };
  const expected = { orderPlacedByTool: false, reservation: 'unconfirmed', readyForPickup: 'unconfirmed' };
  for (const name of ['plan_purchase', 'stock', 'prices', 'basket', 'baskets', 'compare']) {
    const args = { coordinates: { latitude: 0, longitude: 0 } };
    const response = toolReply(name, args, { offers: [offer] });
    const data = (name === 'plan_purchase' ? shoppingReply(response) : response).structuredContent;
    assert.deepEqual(data.orderEvidence, expected);
    assert.deepEqual(JSON.parse(response.content.at(-1).text).orderEvidence, expected);
    assert.deepEqual(data.offers, [offer]);
  }
  for (const name of ['info', 'search', 'compare']) {
    const response = toolReply(name, {}, { results: [] });
    assert.equal(response.structuredContent.orderEvidence, undefined);
  }
});
