import {describePickupStop, describePlanDifference} from 'paguemenos-cli/pickup-plans';
import {publishedAddress} from './stock-coverage.js';
import {clarifyLookup} from './name-choices.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../package.json');
import { registerDrogasilTools } from 'drogasil-cli/mcp-tools';
import {purchaseDescription, purchaseSchema} from './named-baskets.js';
import { providers, retailPartners } from './providers.js';
import { operations, request, schemas } from './index.js';

const productNames = 'Accept a supplied SKU silently. Never ask for, mention, or display a SKU, its value, or a barcode in any user-facing reply, including errors and follow-ups. Identify products by name and presentation. Use the name and presentation for follow-up choices.';

const pickupGuidance = 'Quando a pessoa perguntar se pode ir buscar, diga o que aquela loja informou. A consulta mostra opções de retirada ou unidades na filial. Uma reserva depende de confirmação expressa da loja. Para um pedido online, oriente a aguardar o aviso de que está pronto antes de sair. Se houver um prazo estimado, apresente-o como estimativa. Horário de funcionamento, telefonema e envio de um pedido por si sós não garantem que a caixa esteja separada.';

const presentationGuidance = 'O catálogo encontrou várias apresentações. Em uma pergunta de balcão, faça uma pergunta curta sobre uma diferença que aparece nas opções e que a pessoa ainda não especificou. Priorize dose, forma ou liberação quando diferirem. Se só o tamanho da caixa importar, pergunte quantos comprimidos ela procura. Guarde a relação de produtos para quando a pessoa pedir as opções. Uma apresentação ainda por escolher não confirma estoque. Se já houver resultados de outros itens da cesta, apresente-os. Quando a pessoa escolher uma embalagem, acrescente esse tamanho à consulta do mesmo item. Fabricantes alternativos continuam em uma única linha do pedido.';

const priceGuidance = 'Para “qual sai mais em conta?”, comece pela opção disponível de menor preço conhecido para a quantidade pedida. Em cada tabela da Drogasil, lowestPricedStockedOption aponta para essa linha. Nas outras redes, lowestPricedPickup identifica a oferta de retirada. Se houver uma opção mais perto, mencione-a depois. Se houver preço, consulta ou estoque pendente, limite a comparação às ofertas confirmadas. Use a cobertura da consulta inteira ao responder.';

function needsPresentationChoice(table) {
  if (table.status === 'choose_reference') return table.choices?.length > 1;
  return ['ambiguous', 'presentation_options'].includes(table.status) && table.candidates?.length > 1;
}

const descriptions = {
  retailers: 'List supported Brazilian retailers and the stock and price evidence each can provide.',
  search: 'Search exactly the selected catalogs without a CEP. For nameChoice ask its question, wait for the selected name and pass that option’s onSelect. For a medication name confirmation, ask only confirmation.question verbatim. Stop for the reply. Sim accepts that single term: call pharmacy_search with onYes. Não: call pharmacy_suggest with onNo and show the remaining terms. Use activeIngredients and ingredientEvidence for ingredient questions. Return products only for the requested retailer.',
  suggest: 'Suggest search terms for the selected pharmacy or pharmacies. Always supply the requested retailer. Return suggestions without products or CEP. If nameChoice is present ask its question and wait for a specific choice, then use its onSelect. For a single suggestion ask confirmation.question and wait. Sim: call pharmacy_search with onYes. Não: call this tool with onNo, list the remaining terms, and wait for a selection. If none remain, ask for another spelling. Use listAll only on an explicit request for all suggestions.',
  compare: 'Compare a named presentation and its verified generics at one, several, or all three pharmacies in one call. Send retailer for one chain or retailers for a selection. Omit both for all three. With a numeric local product ID across chains, retailer identifies its owner. For prices alone omit location. For local availability pass the shared CEP or coordinates in this call. After settling brand/generic preference, show the requested product first, then verified generics. Report checkout pickup and delivery evidence. For “na minha loja mais próxima” pass store=nearest to identify the directory branch and check its pickup offer exclusively. closestQuotedPickup ranks the returned pickup options with known distances. For a fixed branch across chains, nearestAmongSelected identifies the closest verified branch, including equal distances. If unconfirmed, report that the closest could not be established. Use Drogasil reported quantities or dated partner inventory for physical stock. A pickup quote confirms the requested quantity for pickup. Use expandSearch only after the shopper accepts the offered 25 km search.',
  basket: 'Quote an explicitly identified basket at one partner using known retailer product and seller identifiers, quantities and the shared CEP or coordinates. Only commonPickupPoints apply to all lines. For a shopper requesting products by name, a retained selection or a pickup itinerary, call plan_purchase directly.',
  baskets: 'Compare an explicitly barcode-defined basket at exactly the selected retailers. For named shopping lists and route planning, call plan_purchase directly. Send the whole basket once. Report complete product subtotals verified for the shared CEP or coordinates separately from Drogasil catalog estimates, and report missing items and fees.',
  stores: 'Look up branches, addresses, published opening hours and phone numbers for the selected retailer or retailers in one call. Page each directory independently. Pague Menos needs a shared origin. With a CEP, Drogasil returns branches in the postal neighborhood or city. Its distance order requires coordinates. Use displayName or storeName and the address to identify a branch. Use published schedules for the requested day and distinguish holiday opening from known hours. Only a shopping lookup can confirm availability.',
  info: 'Get medication facts for all requested names and retailers in one call without a CEP. Pass retailer for one catalog or retailers for an ordered selection. Present findings and missing or failed lookups by retailer. For a retailer-specific identifier select its owning catalog. Use the verified strength paired with its presentation. Cite presentationSource for a corroborated liquid denominator. Say via não confirmada when route evidence conflicts. Answer the facts requested. Give prescription details when asked. Exact controlled forms require prescription.form and its official prescription.rule link. Missing labels are unconfirmed. Pages refer to catalog search.',
  snapshot: 'Save catalog observations for the requested pharmacies. Supply retailer for one run, or retailers for separate runs in selection order. maxItems applies per pharmacy. Read each run with pharmacy_read_snapshot. Catalog availability describes online offers.',
  read_snapshot: 'Read a page of an existing catalog snapshot. Check state and nextOffset before claiming the run is complete.',
  product: 'Read catalog facts and online prices for one SKU, an ordered batch of SKUs, or one exact barcode. Always supply the owning retailer. Do not infer a prescription rule from a missing fact.',
  stock: 'Check one retailer and SKU at the supplied location. All three accept CEP or coordinates. Drogasil reports branch stock. At partner chains, offers describe checkout. When branchInventory supplies a dated count, report its branch and observation time. Missing or stale stock is unknown. Use includeAll for observed zeros and expandSearch only after consent.',
  prices: 'Compare the same product across Brazilian pharmacies using the shared CEP or coordinates. Use retailers for the target chains and retailer for the owner of a numeric SKU. Supply a name, GTIN or SKU. This call identifies every checked chain and returns its status. Rank locally verified prices separately from online-only offers. For choose_reference, let the user identify the pack, then send its retailer and SKU. Ask about generic consent for brand shopping.',
};

function confirmFirst(group, original) {
  const [term] = group.suggestions ?? [];
  if (!term || group.confirmation || group.nameChoice) return group;
  const scope = group.retailers ? {retailers:group.retailers} : {retailer:group.retailerId};
  return { ...group, suggestions: [term], confirmation: {
    question: `Você quis dizer ${term}?`,
    onYesTool: 'pharmacy_search', onNoTool: 'pharmacy_suggest',
    onYes: { query: term, ...scope },
    onNo: { query: original, ...scope, declinedTerm: term },
  } };
}

export function catalogReply(name, args, data) {
  if (data.nameChoice || data.confirmation) return data;
  if (name === 'search') return { ...data, results: data.results.map(group => confirmFirst(group, args.query)) };
  if (name === 'suggest' && !args.declinedTerm && !args.listAll) return confirmFirst(data, args.query);
  return data;
}
// Some clients render structuredContent and some read only the text blocks.
export function toolReply(name, args, value) {
  let data = catalogReply(name, args, Array.isArray(value) ? { retailers: value } : value);
  if (['plan_purchase', 'stock', 'prices', 'basket', 'baskets'].includes(name) ||
      (name === 'compare' && (args.zipcode || args.coordinates))) {
    data = { ...data, orderEvidence: { orderPlacedByTool: false, reservation: 'unconfirmed', readyForPickup: 'unconfirmed' } };
  }
  if (args.store && !data.nameChoice && !data.confirmation && (data.fixedStore || data.results?.some(r => r.fixedStore))) {
    data = {...data, storeScope:'fixed_branch', nextAction:'answer_for_selected_branch'};
  }
  const prompt = data.confirmation ?? (data.results?.length === 1 && data.results[0].confirmation);
  const content = [];
  let structuredContent = data;
  if (data.nameChoice) {
    const nextTool = data.nameChoice.tool ?? (name === 'plan_purchase' ? 'plan_purchase' : 'pharmacy_search');
    structuredContent = {...data, interaction:'awaiting_name_choice', reply:data.nameChoice.question, nextTool};
    content.push({type:'text',text:data.nameChoice.question + '\nAguarde a escolha de um nome. Use ' + nextTool +
      ' com onSelect da opção escolhida. Se a pessoa disser apenas “sim”, peça que escolha um dos nomes.'});
  } else if (name === 'suggest' && args.declinedTerm) {
    const terms = data.suggestions;
    const qualifier = data.status === 'source_failed' ? 'A consulta de outros nomes falhou. ' :
      data.status === 'partial' ? 'Parte das redes não respondeu. ' : '';
    const reply = qualifier + (terms.length ? 'Encontrei '+terms.join(', ')+'. Qual desses nomes aparece na caixa?' :
      'Pode me dizer outra parte do nome ou como ele aparece na caixa?');
    structuredContent = {...data, interaction:terms.length ? 'awaiting_alternative_name' : 'awaiting_spelling', reply};
    content.push({type:'text', text:reply+'\nResponda com o texto acima e aguarde.'});
  } else if (prompt) {
    const instructions = [
      'Responda agora com esta pergunta exata e aguarde:',
      prompt.question,
      'Se a pessoa responder “sim”, execute ' + prompt.onYesTool + ' com ' + JSON.stringify(prompt.onYes) + '.',
      'Se responder “não”, busque as outras sugestões com ' + prompt.onNoTool + ' e os argumentos ' +
        JSON.stringify(prompt.onNo) + '. Apresente os termos retornados.',
    ].join('\n');
    structuredContent = { interaction: 'awaiting_confirmation', reply: prompt.question, nextTurn: instructions, ...data };
    content.push({type:'text', text:instructions});
  }
  content.push({type:'text', text:JSON.stringify(structuredContent)});
  return {content, structuredContent};
}

const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const retailerNames = {drogasil:'Drogasil',paguemenos:'Pague Menos',drogariasaopaulo:'Drogaria São Paulo'};

const addressGuidance = 'Ao identificar uma filial, transcreva o endereço publicado. Preserve abreviações de bairro e omita componentes ausentes.';

function expandedGuidance(wider) {
  const lines = ['Busca ampliada até ' + wider.radiusKm + ' km em linha reta.'];
  if (Number.isSafeInteger(wider.checkedStores)) lines.push('Filiais consultadas nesse alcance: ' + wider.checkedStores + '.');
  const stores = wider.stores;
  if (!wider.partial && Number.isSafeInteger(wider.totalStockedStores)) {
    const n = wider.totalStockedStores;
    lines.push(n + (n === 1 ? ' filial atendeu' : ' filiais atenderam') + ' à quantidade pedida de pelo menos uma opção.');
    if (n > stores.length) lines.push('Listando as ' + stores.length + ' mais próximas.');
  } else {
    lines.push('O total de filiais com a quantidade pedida ficou sem confirmação. Mostre apenas as disponibilidades confirmadas.');
  }
  lines.push(addressGuidance);
  for (const store of stores) {
    const address = store.publishedAddress ?? publishedAddress(store.address);
    const label = [retailerNames[store.retailerId],store.name,address].filter(Boolean).join(' — ');
    lines.push(label);
  }
  lines.push('Informe os itens e as quantidades das filiais listadas. Uma filial omitida pode ter quantidade inferior à pedida. Recomende ligar antes de sair.');
  return lines.join('\n');
}

function itineraryText(result) {
  if (!result?.plans?.length) return null;
  const text = ['Cesta completa. Cada filial visitada conta como uma parada. Use a ordem abaixo.'];
  for (const p of result.plans) {
    const cost = Number.isFinite(p.totalBRL) ? 'subtotal estimado de ' + currency.format(p.totalBRL) : 'subtotal a confirmar';
    const km = Number.isFinite(p.roundTripKm) ? p.roundTripKm.toLocaleString('pt-BR',{maximumFractionDigits:2}) +
      ' km de ida e volta em linha reta' : 'distância total a confirmar';
    const title = {both:'Menos lojas e menor preço estimado',fewest_stores:'Menos lojas',lowest_price:'Menor preço estimado'}[p.objective];
    text.push(title + ' entre as lojas consultadas. ' + p.stopCount + (p.stopCount === 1 ? ' loja, ' : ' lojas, ') + cost + ', ' + km + '.');
    for (const [i,stop] of p.stops.entries()) {
      const chain = retailerNames[stop.retailerId];
      const branch = describePickupStop(stop);
      const label = branch.toLocaleLowerCase('pt-BR').startsWith(chain.toLocaleLowerCase('pt-BR')) ?
        branch : [chain, branch].filter(Boolean).join(' — ');
      text.push((i+1) + '. ' + label);
      for (const pick of stop.pickups) {
        const price = Number.isFinite(pick.unitPriceBRL) ? currency.format(pick.unitPriceBRL) : 'preço a confirmar';
        const evidence = pick.evidence === 'quoted_pickup' ? 'retirada oferecida para a quantidade pedida' :
          pick.reportedStock + ' em estoque na filial, preço de referência';
        text.push('   ' + pick.packs + ' × ' + pick.name + ' · ' + price + ' · ' + evidence + '.');
      }
    }
  }
  if (result.comparison) text.push(describePlanDifference(result.comparison));
  if (result.searchLimited || result.lookupFailures?.length) text.push('Comparação parcial entre as opções verificadas.');
  return text.join('\n');
}

function singlePickupReply(result) {
  if (result.planningScope !== 'one_pack_alternatives' || result.products?.length !== 1 ||
      result.purchase || result.fixedStore || result.quoteStatus === 'partial') return null;
  const [product] = result.products;
  const point = product.closestQuotedPickup;
  if (product.localStatus !== 'available' || point?.channel !== 'pickup-in-point' || !point.pickupPointId ||
      !Number.isFinite(point.distanceKm) || !Number.isSafeInteger(product.requestedQuantity) ||
      product.requestedQuantity < 1 || product.branchQuantity != null) return null;
  const address = describePickupStop({name:point.branch, address:point.address});
  if (!address) return null;
  const label = [product.name, product.manufacturer, product.type].filter(Boolean).join(' · ');
  const quantity = product.requestedQuantity === 1 ? 'uma caixa' : product.requestedQuantity+' caixas';
  const price = Number.isFinite(product.currentPrice) ? ', a '+currency.format(product.currentPrice)+' por caixa' : '';
  const km = point.distanceKm.toLocaleString('pt-BR',{maximumFractionDigits:2});
  return 'Segundo o site, dá para retirar '+quantity+' de '+label+price+', na '+address+
    ' ('+km+' km em linha reta), a filial mais próxima entre as que ofereceram retirada.';
}

export function shoppingReply(response) {
  const data = response.structuredContent;
  if (!data) return response;
  const guidance = {};
  const wider = data.expandedSearch ?? data.purchase?.expandedSearch;
  if (wider) guidance.expandedGuidance = expandedGuidance(wider);
  const outcomes = data.results ?? [data];
  if (!wider && data.storeScope !== 'fixed_branch' && outcomes.some(row => !row.fixedStore && row.planningScope === 'one_pack_alternatives')) {
    guidance.pickupDisplayGuidance = 'Para uma pergunta comum de compra, mostre cada apresentação uma vez, somente na filial mais próxima com retirada oferecida para a quantidade pedida. Se a distância estiver incompleta, diga que a filial mais próxima ficou sem confirmação. Liste outras filiais ou entrega quando a pessoa pedir. Uma opção cabe em uma frase.';
    const reply = singlePickupReply(data);
    if (reply) guidance.suggestedPickupReply = reply;
  }
  if (outcomes.some(row => row.tables?.some(t => t.status === 'requested_brand_not_found'))) {
    guidance.manufacturerGuidance = 'Diga “Não encontrei essa apresentação do fabricante no catálogo consultado”. A consulta descreve os resultados observados. O estoque físico dessa caixa está a confirmar. Preserve a preferência e encerre a resposta. Use a URL apenas como link da fonte.';
  } else if (outcomes.some(row => row.tables?.some(t => t.status === 'no_match'))) {
    guidance.catalogMissGuidance = 'Diga “Não encontrei essa apresentação no catálogo consultado”. A rede pode ter outras ofertas fora dos resultados verificados. O estoque físico dessa caixa está a confirmar.';
  }
  if (outcomes.some(row => row.tables?.some(needsPresentationChoice))) guidance.presentationGuidance = presentationGuidance;
  if (data.storeScope !== 'fixed_branch' && outcomes.some(row => row.coverage || row.planningScope === 'one_pack_alternatives')) guidance.priceGuidance = priceGuidance;
  if (outcomes.some(row => row.fixedStore)) {
    guidance.fixedStoreGuidance = 'A consulta à filial escolhida terminou. Responda agora sobre essa filial e encerre o turno. Verifique outra loja apenas se a pessoa solicitar essa busca. Não faça outra chamada para procurar uma alternativa por iniciativa própria. Use o nome e endereço em fixedStore.branch. Para offered, diga “Segundo o site, dá para retirar a quantidade pedida nessa loja”. Para not_offered, diga que o site não ofereceu retirada nessa loja. Para unconfirmed ou lookup_failed, informe que a retirada ficou sem confirmação. Se faltarem distâncias, limite a afirmação de proximidade às lojas com distância conhecida.';
  }
  if (!wider && data.checkedRetailers && data.scope === 'whole_basket_per_retailer') {
    guidance.retailerGuidance = data.coverage?.canExpand
      ? 'A consulta local confirmou zero em todas as redes selecionadas. Informe a cobertura e pergunte se a pessoa quer ampliar para 25 km. Aguarde a resposta.'
      : 'Responda com os resultados locais das redes selecionadas e encerre a busca. Informe a disponibilidade confirmada e qualquer informação pendente.';
  }
  const itinerary = itineraryText(data.crossRetailerPlans ?? data.pickupPlans ?? (outcomes.length === 1 ? outcomes[0].pickupPlans : undefined));
  if (itinerary && !data.nextAction) {
    guidance.nextAction = 'answer_with_plan';
    guidance.itineraryGuidance = 'Informe a filial e o endereço por item e o subtotal estimado. Quando os planos diferirem, explique a economia, a mudança de paradas e a diferença de percurso em linha reta. A consulta está concluída. Preserve os avisos de cobertura parcial.';
  }
  const notes = [itinerary,...Object.entries(guidance).filter(([key]) => key !== 'nextAction').map(([,text]) => text)].filter(Boolean);
  if (!notes.length) return response;
  const structuredContent = { ...data, ...guidance };
  return { ...response, structuredContent, content: [
    { type: 'text', text: notes.join(' ') },
    { type: 'text', text: JSON.stringify(structuredContent) },
  ] };
}

export function createServer(monitor = null) {
  const server = new McpServer({ name: 'farmacias-br', version }, {
    instructions: purchaseDescription + ' ' + productNames + ' ' + pickupGuidance + ' ' + addressGuidance + ' Use pharmacy_* tools for Pague Menos and Drogaria São Paulo. For their factual questions call pharmacy_info without a CEP. For a brand shopping request settle generic preference first. A named shopping list or a returning shopper’s selection goes straight to plan_purchase. Use the returned itinerary to answer. For fixed-store shopping use plan_purchase with store=nearest for any chain. Drogasil reports shelf quantities and supports 25 km expansion.'
  });
  const registry = {
    registerTool(name, options, handler) {
      const description = options.description + ' ' + productNames;
      const run = monitor ? (args, extra) => monitor.run(name, args, () => handler(args, extra)) : handler;
      return server.registerTool(name, {...options, description}, run);
    },
  };
  registerDrogasilTools({
    registerTool(name, options, handler) {
      if (name === 'plan_purchase') {
        return registry.registerTool(name, {...options, inputSchema:purchaseSchema,
          description:purchaseDescription + ' ' + options.description}, async args =>
          shoppingReply(toolReply(name, args, await request('plan', args))));
      }
      if (name==='compare_pharmacy_prices') {
        return registry.registerTool(name,{...options,inputSchema:{...options.inputSchema,retailers:schemas.baskets.shape.retailers.optional()},
          description:descriptions.prices},async args=>toolReply('prices',args,await request('prices',args)));
      }
      if (['search_products','compare_products','get_medication_info'].includes(name)) {
        const description = 'Drogasil only. Ask the exact returned confirmation or nameChoice question before showing products. ' + options.description;
        return registry.registerTool(name, {...options, description}, async (args, extra) => {
          const pending = await clarifyLookup(name, args, {retailer:'drogasil'});
          if (pending) return toolReply(name, args, {...pending, ...(name === 'search_products' && {products:[], page:args.page})});
          if (name !== 'search_products') {
            const response = await handler(args,extra);
            return response.structuredContent?.expandedSearch ? shoppingReply(response) : response;
          }
          const {products, pages} = await providers.drogasil.searchCatalogPage(args.query, args.page, args.limit);
          return toolReply(name, args, {
            status:products.length ? 'matches' : 'no_reference', page:args.page, pages,
            ...(!products.length && {hint:'Peça outra grafia ou apresentação se quiser ampliar a consulta.'}),
            products:products.map(({sku, name, brand, type, pack, currentPrice, activeIngredients, ingredientEvidence}) =>
              ({sku, name, brand, type, pack, referencePriceBRL:currentPrice, activeIngredients, ingredientEvidence})),
          });
        });
      }
      const shared = name==='read_catalog_snapshot';
      const description = shared ? options.description : 'Drogasil only. ' + options.description;
      return registry.registerTool(name,{...options,description},name === 'find_nearby_stock' ? async (args,extra) => {
        const response = await handler(args,extra);
        return response.structuredContent?.expandedSearch ? shoppingReply(response) : response;
      } : handler);
    },
  }, z, retailPartners);
  for (const [name, description] of Object.entries(descriptions)) {
    registry.registerTool('pharmacy_' + name, { description, inputSchema: schemas[name],
      annotations: { readOnlyHint: name !== 'snapshot', destructiveHint: false, openWorldHint: !['retailers','read_snapshot'].includes(name) } }, async args => {
      const value = await request(name, args);
      const response = toolReply(name,args,value);
      return value.expandedSearch || value.purchase?.expandedSearch ? shoppingReply(response) : response;
    });
  }
  return server;
}

export function localApp(monitor = null) {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('origin') && req.get('origin') !== 'http://' + req.get('host')) return res.sendStatus(403);
    next();
  });
  app.get('/api/v1/retailers', (_req, res) => res.json(operations.retailers()));
  app.post('/api/v1/:operation', async (req, res) => {
    const { operation } = req.params;
    if (!Object.hasOwn(operations, operation)) return res.sendStatus(404);
    const input = schemas[operation].safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'invalid_request', fields: input.error.issues.map(issue => issue.path.join('.')) });
    try {
      const lookup = () => request(operation, input.data);
      res.json(await (monitor ? monitor.run(operation, input.data, lookup) : lookup()));
    }
    catch { res.status(502).json({ error: 'source_failed' }); }
  });
  app.post('/mcp', async (req, res) => {
    const server = createServer(monitor);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.once('close', () => { void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => res.set('Allow', 'POST').sendStatus(405));
  return app;
}
