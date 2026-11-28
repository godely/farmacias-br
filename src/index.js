import { z } from 'zod';
import { validGtin } from 'paguemenos-cli/vtex';
import { inventoryConfig, lookupBranchStock } from 'paguemenos-cli/branch-inventory';
import { compareSelection } from './presentation-comparisons.js';
import {planSelectedBaskets, purchaseSchema} from './named-baskets.js';
import { compareBaskets } from './baskets.js';
import { retailerBasket, retailerComparison, catalogInfo, catalogType, requestsDrops } from 'drogasil-cli/retailer-workflows';
import { alternativeNames } from 'drogasil-cli/medication-catalog';
import { compareRetailPrices, readSnapshot } from 'drogasil-cli';
import { snapshotQueriesSchema } from 'drogasil-cli/mcp-tools';
import { providers } from './providers.js';
import { nameChoices, choiceFollowup, clarifyLookup } from './name-choices.js';
import { startSnapshots } from './snapshot-scopes.js';

export const retailerIds = Object.keys(providers);
const retailer = z.enum(retailerIds);
const selection = z.array(retailer).min(1).max(3).refine(ids => new Set(ids).size === ids.length, 'Rede repetida');
const partner = z.enum(['paguemenos','drogariasaopaulo']);
const sku = z.string().trim().regex(/^\d{1,20}$/);
const zipcode = z.string().trim().regex(/^\d{5}-?\d{3}$/).refine(value => !/^0+-?0+$/.test(value), 'CEP inválido');
const coordinates = z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const location = { zipcode: zipcode.optional(), coordinates: coordinates.optional() };
const withLocation = shape => z.strictObject({ ...shape, ...location })
  .refine(value => Boolean(value.zipcode || value.coordinates), 'Informe o CEP ou as coordenadas')
  .refine(value => !(value.zipcode && value.coordinates), 'Informe apenas uma origem');
const query = z.string().trim().min(1).max(150);
export const schemas = {
  plan: purchaseSchema,
  retailers: z.strictObject({}),
  search: z.strictObject({ query, retailer: retailer.optional(), retailers: selection.optional(), page: z.number().int().min(1).max(100).default(1),
    limit: z.number().int().min(1).max(100).default(10) }).refine(v=>!v.retailer || !v.retailers,'Use retailer ou retailers'),
  suggest: z.strictObject({ query, retailer: retailer.optional(), retailers: selection.optional(),
    declinedTerm: query.optional().describe('Previously proposed term the user declined. Return remaining suggestions.'),
    listAll: z.boolean().optional().describe('Use only when the user explicitly requests a list of terms.'),
    limit: z.number().int().min(1).max(50).default(7) }).refine(v=>!v.retailer || !v.retailers,'Use retailer ou retailers'),
  product: z.strictObject({ retailer, sku:sku.optional(), skus:z.array(sku).min(1).max(100).optional(),
    gtin:z.string().refine(validGtin, 'GTIN inválido').optional() }).refine(
    args => [args.sku,args.skus,args.gtin].filter(Boolean).length === 1, 'Informe SKU, SKUs ou GTIN'),
  stores: z.strictObject({retailer:retailer.optional(), retailers:selection.optional(), ...location,
    page:z.number().int().positive().default(1), limit:z.number().int().min(1).max(100).default(20)})
    .refine(v => Boolean(v.retailer) !== Boolean(v.retailers),'Selecione a rede ou as redes')
    .refine(v => !(v.zipcode && v.coordinates),'Informe apenas uma origem'),
  compare: z.strictObject({retailer:retailer.optional(), retailers:selection.optional(), query, includeGenerics:z.boolean(), store:z.union([z.literal('nearest'),sku]).optional(), expandSearch:z.boolean().optional(), ...location})
    .refine(v=>!v.retailer || !v.retailers || /^\d+$/.test(v.query), 'Para um nome, selecione retailer ou retailers')
    .refine(v=>!v.store || v.store==='nearest' || (v.retailers?.length ?? (v.retailer ? 1 : retailerIds.length))===1, 'Selecione uma rede para uma filial específica')
    .refine(v=>!v.expandSearch || (!v.store && Boolean(v.zipcode || v.coordinates)), 'Ampliar exige localização e busca entre lojas')
    .refine(v=>!v.store || Boolean(v.zipcode || v.coordinates),'Informe a localização para escolher a filial')
    .refine(v=>!(v.zipcode && v.coordinates),'Informe apenas uma origem'),
  basket: withLocation({retailer:partner, items:z.array(z.strictObject({sku,
    sellerId:z.string().trim().min(1).max(100).optional(), quantity:z.number().int().min(1).max(1000).default(1)})).min(1).max(20)}),
  baskets: withLocation({retailers:selection,items:z.array(z.strictObject({gtin:z.string().refine(validGtin),quantity:z.number().int().min(1).max(1000).default(1),sellers:z.partialRecord(retailer,z.string()).optional()})).min(1).max(20)}),
  info: z.strictObject({retailer:retailer.optional(), retailers:selection.optional(), scope:z.enum(['catalog','brazil']).default('catalog'), queries:z.array(query).min(1).max(10),
    page:z.number().int().min(1).max(100).default(1), limit:z.number().int().min(1).max(50).default(20)})
    .refine(args => Boolean(args.retailer) !== Boolean(args.retailers), 'Selecione a rede ou as redes para a consulta'),
  snapshot: z.strictObject({retailer:retailer.optional(), retailers:z.array(retailer).min(1).max(3)
    .refine(ids => new Set(ids).size === ids.length, 'Rede repetida').optional(),
    queries:snapshotQueriesSchema(z), maxItems:z.number().int().min(1).max(1000).default(20)})
    .refine(args => Boolean(args.retailer) !== Boolean(args.retailers), 'Selecione as redes para a coleta'),
  read_snapshot: z.strictObject({runId:z.string().uuid(), offset:z.number().int().min(0).default(0), limit:z.number().int().min(1).max(1000).default(20)}),
  stock: withLocation({ retailer, sku, quantity: z.number().int().min(1).max(1000).optional(),
    includeAll:z.boolean().optional(), expandSearch:z.boolean().optional(), maxBranches:z.number().int().min(3).max(30).optional() })
    .refine(v=>!v.maxBranches || !!v.zipcode,'O limite de filiais exige CEP')
    .refine(v=>!(v.includeAll && v.quantity != null),'Escolha entre todas as lojas e uma quantidade mínima'),
  prices: withLocation({ query, retailer: retailer.optional().describe('Retailer owning the numeric SKU in query'),
    includeGenerics: z.boolean().default(false), retailers: selection.optional() }),
};
const stockEvidence = { drogasil: 'branch_quantity', paguemenos: 'fulfillment_quote',
  drogariasaopaulo: 'fulfillment_quote' };

export function listRetailers() {
  return retailerIds.map(id => {
    let source = 'not_configured';
    try { if (inventoryConfig(id)) source = 'snapshot_configured'; }
    catch { source = 'configuration_failed'; }
    const configured = source === 'snapshot_configured';
    return { id, retailer: providers[id].name, stockEvidence: stockEvidence[id],
    capabilities:{batchSku:true, exactGtin:true, medicationInfo:'catalog', catalogSnapshots:true,
      stockOrigin:['cep','coordinates'], directoryScope:providers[id].directoryScope??'national',
      storeDirectory:typeof providers[id].stores === 'function', nearestBranch:true, fixedBranchEvidence:stockEvidence[id], exactBranchQuantity:id === 'drogasil' || configured,
      branchInventorySource:id === 'drogasil' ? 'live' : source,
      namedBasket:true, locationAwareComparison:true, purchasePlan:true, planningEvidence:id === 'drogasil' ? 'reported_branch_stock' : 'confirmed_pickup_points', equivalentPresentations:id === 'drogasil' ? 'native' : 'verified_barcode_bridge',
      basket:id === 'drogasil' ? 'branch_plan' : 'joint_fulfillment_quote'},
    priceEvidence: stockEvidence[id] === 'fulfillment_quote' ? 'cep_quote_if_fulfillable' : 'online_or_reference' };
  });
}

function labeled(row, id) {
  return { ...row, retailerId: id, type: catalogType(row) };
}
function summary(row, id) {
  const { facts, ...fields } = labeled(row, id);
  return fields;
}

export async function suggestTerms(args, sources = providers) {
  const { query, retailer = 'paguemenos', retailers, limit, declinedTerm } = schemas.suggest.parse(args);
  if (retailers) {
    const results = await Promise.all(retailers.map(id => suggestTerms({query, retailer:id, limit, declinedTerm}, sources)));
    const suggestions = [...new Set(results.flatMap(group => group.suggestions))].slice(0, limit);
    const failed = results.filter(group => group.status === 'source_failed').length;
    const status = failed === results.length ? 'source_failed' : failed ? 'partial' :
      suggestions.length ? 'suggestions' : 'no_suggestions';
    return {retailers, results, suggestions, status};
  }
  try {
    const source = sources[retailer];
    let suggestions = declinedTerm && source.alternatives
      ? await source.alternatives(query, declinedTerm, 50)
      : await source.suggest(query, declinedTerm ? 50 : limit);
    if (declinedTerm) {
      suggestions = alternativeNames(suggestions, query, [declinedTerm], limit);
    }
    return { retailerId: retailer, status: suggestions.length ? 'suggestions' : 'no_suggestions', suggestions };
  } catch {
    return { retailerId: retailer, status: 'source_failed', suggestions: [] };
  }
}

function termKey(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');
}

export async function searchCatalog(args, sources = providers, clarify = nameChoices) {
  const { query, retailer, retailers, page, limit } = schemas.search.parse(args);
  const ids = retailers ?? (retailer ? [retailer] : retailerIds);
  const choices = await clarify(query);
  if (choices.length) {
    const scope = retailer ? {retailer} : {retailers:ids};
    const followup = term => ({...scope, query:term, limit});
    const resolution = choiceFollowup(choices, 'pharmacy_search', followup, {...scope, query});
    return {page, limitPerRetailer:limit, ...resolution, results:ids.map(id => ({
      retailerId:id, status:'needs_name_confirmation', products:[], suggestions:choices,
      suggestionStatus:'suggestions', ...resolution,
    }))};
  }
  const results = await Promise.all(ids.map(async id => {
    try {
      const source = sources[id];
      let rows;
      if (id !== 'drogasil' && source.byGtin && query.includes(' ') && requestsDrops(query)) {
        const matches = await retailerComparison({retailer:id, query, includeGenerics:false}, source);
        rows = (matches.candidates ?? matches.products ?? []).slice((page - 1) * limit, page * limit);
      } else {
        rows = source.searchCatalog ? await source.searchCatalog(query, page, limit) : await source.search(query, page, limit);
      }
      const group = { retailerId: id, status: rows.length ? 'matches' : 'no_match',
        products: rows.map(row => {
          const fields = summary(row, id);
          if (id === 'paguemenos' && !fields.activeIngredients?.length) {
            const active = row.facts?.NomeSubstanciaPrincipioAtivo;
            fields.activeIngredients = [active].flat().filter(value => typeof value === 'string' && value.trim());
          }
          return fields;
        }) };
      if (sources[id].suggest && page === 1 && !rows.length) {
        const completion = await suggestTerms({ query, retailer: id }, sources);
        group.suggestions = completion.suggestions.filter(term => termKey(term) !== termKey(query));
        group.suggestionStatus = completion.status === 'source_failed' ? 'source_failed'
          : group.suggestions.length ? 'suggestions' : 'no_suggestions';
      }
      return group;
    } catch {
      return { retailerId: id, status: 'source_failed', products: [] };
    }
  }));
  return { page, limitPerRetailer: limit, results };
}

export async function getProduct(args, sources = providers) {
  const { retailer, sku, skus, gtin } = schemas.product.parse(args);
  const source = sources[retailer];
  if (gtin) {
    const rows = (await source.byGtin(gtin)).filter(row => row.gtin === gtin);
    return {retailerId:retailer, gtin, status:rows.length ? 'matches' : 'unknown_gtin',
      products:rows.map(row => labeled(row,retailer))};
  }
  if (skus) {
    const found = new Map();
    for (const id of new Set(skus)) {
      try { found.set(id, await getProduct({retailer,sku:id}, sources)); }
      catch { found.set(id,{retailerId:retailer, status:'source_failed',products:[]}); }
    }
    return {retailerId:retailer, results:skus.map(id => ({sku:id,...found.get(id)}))};
  }
  const rows = await source.product(sku);
  return { retailerId: retailer, status: rows.length ? 'matches' : 'unknown_sku',
    products: rows.map(row => labeled(row, retailer)) };
}

export async function getStock(args, sources = providers) {
  const { retailer, sku, zipcode, coordinates, quantity = 1, includeAll, expandSearch, maxBranches } = schemas.stock.parse(args);
  const source = sources[retailer];
  const evidence = stockEvidence[retailer];
  let rows;
  try {
    if (zipcode && source.serves && !await source.serves(zipcode)) {
      return { retailerId: retailer, evidence, status: 'outside_local_directory', offers: [] };
    }
    rows = await source.product(sku);
  } catch {
    return {retailerId:retailer, evidence, status:'source_failed', offers:[]};
  }
  if (!rows.length) return { retailerId: retailer, evidence, status: 'unknown_sku', offers: [] };
  const offers = [];
  for (const row of rows) {
    try { offers.push(summary(await source.local(row, coordinates ?? zipcode, quantity, {includeAll,expandSearch,maxBranches}), retailer)); }
    catch { offers.push({ ...summary(row, retailer), localStatus: 'lookup_failed' }); }
  }
  let config;
  let branchInventory;
  const failures = offers.filter(row => row.localStatus === 'lookup_failed').length;
  const incomplete = offers.some(row => row.pickupVerification && row.pickupVerification.status !== 'verified');
  try { config = inventoryConfig(retailer); }
  catch { branchInventory = {status:'source_failed', evidence:'branch_inventory_configuration_failed', stores:[]}; }
  const physicalRequested = includeAll || expandSearch || maxBranches != null;
  if (config) {
    const canCheckWider = !failures && !incomplete && !offers.some(row => row.methods?.some(m =>
      row.localStatus === 'available' && m.channel === 'pickup-in-point' && m.pickupPointId));
    try {
      branchInventory = await lookupBranchStock(retailer, source, coordinates ?? zipcode, sku, config,
        {minimum:quantity, includeAll, maxBranches, expand:canCheckWider && expandSearch});
      if (!canCheckWider) branchInventory.coverage.canExpand = false;
    } catch {
      branchInventory = {status:'source_failed', evidence:'branch_inventory_lookup_failed', stores:[]};
    }
  } else if (!branchInventory && physicalRequested && retailer !== 'drogasil') {
    branchInventory = {status:'unknown', evidence:'no_branch_inventory_source', stores:[]};
  }
  return { retailerId: retailer, evidence, status: failures === rows.length ? 'source_failed' : failures || incomplete ? 'partial' : 'checked', offers, ...(branchInventory && {branchInventory}) };
}

export async function comparePrices(args, { compare = compareRetailPrices, sources = providers } = {}) {
  const { query, zipcode, coordinates, retailer, retailers = retailerIds, includeGenerics } = schemas.prices.parse(args);
  let reference = query;
  if (retailer) {
    const product = await getProduct({ retailer, sku: query }, sources);
    if (!product.products.length) return product;
    const codes = [...new Set(product.products.map(row => row.gtin).filter(Boolean))];
    if (codes.length !== 1) return { status: 'unconfirmed_gtin', reference: product };
    reference = codes[0];
  }
  const named = !retailer && !/^\d+$/.test(query);
  let result;
  try {
    result = await compare(reference, { zipcode, coordinates, retailers: retailers.filter(id=>id!=='drogasil').map(id=>sources[id]), includeDrogasil:retailers.includes('drogasil'), includeGenerics });
  } catch (error) {
    if (!named) throw error;
    result = { status: 'source_failed', issues: [{ retailer: 'Drogasil', status: 'reference_lookup_failed' }] };
  }
  if (!named || !['source_failed','no_reference'].includes(result.status)) return result;

  // Other catalogs may list a presentation missing from the primary catalog.
  // A search hit is only a candidate until the user identifies the pack.
  const discovery = await searchCatalog({ query, retailers, limit: 5 }, sources);
  const candidates = discovery.results.flatMap(group => group.products);
  return { ...result, status: candidates.length ? 'choose_reference' : result.status, candidates,
    discovery: discovery.results.map(({ retailerId, status }) => ({ retailerId, status })) };
}

export async function medicationInfo(args, sources = providers) {
  const input = schemas.info.parse(args);
  const national = new Map();
  function nationalInfo([term], options) {
    if (!national.has(term)) national.set(term, sources.drogasil.info([term], options));
    return national.get(term);
  }
  if (!input.retailers) return retailerInfo(input, sources[input.retailer], nationalInfo);
  if (input.retailers.length > 1 && input.queries.some(term => /^\d+$/.test(term))) {
    return {status:'requires_retailer', retailers:input.retailers,
      question:'De qual farmácia é o produto que você indicou pelo código? Também posso procurar pelo nome nas redes escolhidas.'};
  }

  const results = await Promise.all(input.retailers.map(async retailer => {
    const group = await retailerInfo({...input, retailer}, sources[retailer], nationalInfo);
    const failed = group.results.filter(row => row.status === 'source_failed').length;
    const partial = group.results.some(row => row.status === 'partial' || row.nationalStatus === 'source_failed' || row.brazil?.lookupFailed);
    const status = failed === group.results.length ? 'source_failed' : failed || partial ? 'partial' : 'checked';
    return {...group, status};
  }));
  const failed = results.filter(group => group.status === 'source_failed').length;
  const status = failed === results.length ? 'source_failed' :
    results.some(group => group.status !== 'checked') ? 'partial' : 'checked';
  return {retailers:input.retailers, status, results};
}

async function retailerInfo(input, source, nationalInfo) {
  if (input.retailer !== 'drogasil') return catalogInfo(input, source, nationalInfo);
  const results = [];
  for (const query of input.queries) {
    try {
      const data = input.scope === 'brazil' ? await nationalInfo([query], {scope:input.scope}) :
        await source.info([query], {scope:input.scope});
      const row = data.results[0];
      const products = /^\d+$/.test(query) ? row.products :
        row.products.slice((input.page-1)*input.limit, input.page*input.limit);
      results.push({...row, products});
    } catch {
      results.push({query, status:'source_failed', products:[]});
    }
  }
  return {scope:input.scope, retailerId:input.retailer, page:input.page, limitPerQuery:input.limit, results};
}
const locatorPages = {
  paguemenos:'https://www.paguemenos.com.br/nossas-lojas',
  drogariasaopaulo:'https://www.drogariasaopaulo.com.br/institucional/nossas-lojas',
};

export async function storeDirectories(args, sources = providers) {
  const {retailer, retailers, page, limit, zipcode, coordinates} = schemas.stores.parse(args);
  async function directory(id) {
    const provider = sources[id];
    let result;
    if (id === 'drogasil') {
      result = await provider.directory(coordinates ?? (zipcode ? {zipcode} : undefined));
    } else {
      const scope = provider.directoryScope;
      const origin = coordinates ?? zipcode;
      if (scope === 'near_origin' && !origin) {
        return {retailerId:id,status:'requires_origin',scope,source:locatorPages[id],page,total:null,stores:[]};
      }
      const stores = await provider.stores(origin);
      result = {status:'checked', scope, stores, source:locatorPages[id],
        order:origin ? (id === 'paguemenos' ? 'locator_distance' : 'straight_line_distance') : 'directory'};
    }
    return {...result, retailerId:id, page, total:result.status === 'checked' ? result.stores.length : null,
      stores:result.stores.slice((page-1)*limit, page*limit)};
  }
  if (retailer) return directory(retailer);
  const results = await Promise.all(retailers.map(async id => {
    try { return await directory(id); }
    catch { return {retailerId:id,status:'source_failed',page,total:null,stores:[]}; }
  }));
  const states = new Set(results.map(group => group.status));
  return {retailers, page, limitPerRetailer:limit, status:states.size === 1 ? results[0].status : 'partial', results};
}

export function comparePresentations(input, dependencies) {
  return compareSelection(schemas.compare.parse(input), dependencies);
}

export const operations = { plan: planSelectedBaskets, retailers: listRetailers, search: searchCatalog, suggest: suggestTerms, product: getProduct,
  stock: getStock, prices: comparePrices, info: medicationInfo,
  baskets: args => compareBaskets(args,providers),
  stores: storeDirectories,
  compare: comparePresentations,
  basket: args => retailerBasket(args, providers[args.retailer]),
  snapshot: args => startSnapshots(args,providers),
  read_snapshot: ({runId,...page}) => readSnapshot(runId,page) };
export async function request(operation, input) {
  if (!Object.hasOwn(operations, operation)) throw new TypeError('Operação desconhecida');
  const args = schemas[operation].parse(input);
  if (['prices','compare','info'].includes(operation)) {
    const scope = operation === 'prices' || args.retailers || (operation === 'compare' && !args.retailer) ? {retailers:args.retailers ?? retailerIds} : {retailer:args.retailer};
    const pending = await clarifyLookup('pharmacy_' + operation, args, scope);
    if (pending) return pending;
  }
  const result = await operations[operation](args);
  if (operation === 'suggest' && !args.listAll && !args.declinedTerm && result.suggestions.length) {
    const choices = await nameChoices(args.query);
    if (choices.length > 1) {
      const scope = args.retailers ? {retailers:args.retailers} : {retailer:result.retailerId};
      return {...result, ...choiceFollowup(choices, 'pharmacy_search',
        query => ({...scope, query, limit:args.limit}), {...scope, query:args.query})};
    }
  }
  return result;
}
