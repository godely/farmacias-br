import { z } from 'zod';
import { validGtin } from 'paguemenos-cli/vtex';
import { compareOffers } from 'paguemenos-cli/compare';
import { compareBaskets } from './baskets.js';
import { retailerBasket, catalogInfo, catalogType } from 'drogasil-cli/retailer-workflows';
import { compareRetailPrices, getMedicationInfo, readSnapshot } from 'drogasil-cli';
import { providers } from './providers.js';
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
  .refine(value => Boolean(value.zipcode || value.coordinates), 'Informe o CEP ou as coordenadas');
const query = z.string().trim().min(1).max(150);
export const schemas = {
  retailers: z.strictObject({}),
  search: z.strictObject({ query, retailer: retailer.optional(), retailers: selection.optional(), page: z.number().int().min(1).max(100).default(1),
    limit: z.number().int().min(1).max(100).default(10) }).refine(v=>!v.retailer || !v.retailers,'Use retailer ou retailers'),
  suggest: z.strictObject({ query, retailer: partner.default('paguemenos'),
    declinedTerm: query.optional().describe('Previously proposed term the user declined. Return remaining suggestions.'),
    listAll: z.boolean().optional().describe('Use only when the user explicitly requests a list of terms.'),
    limit: z.number().int().min(1).max(50).default(7) }),
  product: z.strictObject({ retailer, sku:sku.optional(), skus:z.array(sku).min(1).max(100).optional(),
    gtin:z.string().refine(validGtin, 'GTIN inválido').optional() }).refine(
    args => [args.sku,args.skus,args.gtin].filter(Boolean).length === 1, 'Informe SKU, SKUs ou GTIN'),
  stores: z.strictObject({retailer, ...location,
    page:z.number().int().positive().default(1), limit:z.number().int().min(1).max(100).default(20)}),
  compare: z.strictObject({retailer:partner, query, includeGenerics:z.boolean(), ...location})
    .refine(v=>!(v.zipcode && v.coordinates),'Informe apenas uma origem'),
  basket: z.strictObject({retailer:partner, zipcode, items:z.array(z.strictObject({sku,
    sellerId:z.string().trim().min(1).max(100).optional(), quantity:z.number().int().min(1).max(1000).default(1)})).min(1).max(20)}),
  baskets: z.strictObject({retailers:selection,zipcode,items:z.array(z.strictObject({gtin:z.string().refine(validGtin),quantity:z.number().int().min(1).max(1000).default(1),sellers:z.partialRecord(retailer,z.string()).optional()})).min(1).max(20)}),
  info: z.strictObject({retailer, scope:z.enum(['catalog','brazil']).default('catalog'), queries:z.array(query).min(1).max(10),
    page:z.number().int().min(1).max(100).default(1), limit:z.number().int().min(1).max(50).default(20)}),
  snapshot: z.strictObject({retailer:retailer.optional(), retailers:z.array(retailer).min(1).max(3)
    .refine(ids => new Set(ids).size === ids.length, 'Rede repetida').optional(),
    queries:z.array(query).min(1).max(10), maxItems:z.number().int().min(1).max(1000).default(20)})
    .refine(args => Boolean(args.retailer) !== Boolean(args.retailers), 'Selecione as redes para a coleta'),
  read_snapshot: z.strictObject({runId:z.string().uuid(), offset:z.number().int().min(0).default(0), limit:z.number().int().min(1).max(1000).default(20)}),
  stock: withLocation({ retailer, sku, quantity: z.number().int().min(1).max(1000).default(1) }),
  prices: withLocation({ query, retailer: retailer.optional().describe('Retailer owning the numeric SKU in query'),
    includeGenerics: z.boolean().default(false), retailers: selection.optional() }),
};
const stockEvidence = { drogasil: 'branch_quantity', paguemenos: 'fulfillment_quote',
  drogariasaopaulo: 'fulfillment_quote' };

export function listRetailers() {
  return retailerIds.map(id => ({ id, retailer: providers[id].name, stockEvidence: stockEvidence[id],
    capabilities:{batchSku:true, exactGtin:true, medicationInfo:'catalog', catalogSnapshots:true,
      stockOrigin:['cep','coordinates'], directoryScope:providers[id].directoryScope??'national',
      storeDirectory:typeof providers[id].stores === 'function', nearestBranch:id === 'drogasil', exactBranchQuantity:id === 'drogasil',
      namedBasket:true, locationAwareComparison:true, purchasePlan:id === 'drogasil', equivalentPresentations:id === 'drogasil' ? 'native' : 'verified_barcode_bridge',
      basket:id === 'drogasil' ? 'branch_plan' : 'joint_fulfillment_quote'},
    priceEvidence: stockEvidence[id] === 'fulfillment_quote' ? 'cep_quote_if_fulfillable' : 'online_or_reference' }));
}

function labeled(row, id) {
  return { ...row, retailerId: id, type: catalogType(row) };
}
function summary(row, id) {
  const { facts, ...fields } = labeled(row, id);
  return fields;
}

export async function suggestTerms(args, sources = providers) {
  const { query, retailer, limit, declinedTerm } = schemas.suggest.parse(args);
  try {
    const source = sources[retailer];
    let suggestions = declinedTerm && source.alternatives
      ? await source.alternatives(query, declinedTerm, limit)
      : await source.suggest(query, declinedTerm ? Math.min(limit + 2, 50) : limit);
    if (declinedTerm) {
      const excluded = new Set([termKey(query), termKey(declinedTerm)]);
      suggestions = suggestions.filter(term => !excluded.has(termKey(term))).slice(0, limit);
    }
    return { retailerId: retailer, status: suggestions.length ? 'suggestions' : 'no_suggestions', suggestions };
  } catch {
    return { retailerId: retailer, status: 'source_failed', suggestions: [] };
  }
}

function termKey(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');
}

export async function searchCatalog(args, sources = providers) {
  const { query, retailer, retailers, page, limit } = schemas.search.parse(args);
  const ids = retailers ?? (retailer ? [retailer] : retailerIds);
  const results = await Promise.all(ids.map(async id => {
    try {
      const rows = await sources[id].search(query, page, limit);
      const group = { retailerId: id, status: rows.length ? 'matches' : 'no_match',
        products: rows.map(row => {
          const fields = summary(row, id);
          if (id === 'paguemenos') {
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
  const { retailer, sku, zipcode, coordinates, quantity } = schemas.stock.parse(args);
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
  let failures = 0;
  for (const row of rows) {
    try { offers.push(summary(await source.local(row, coordinates ?? zipcode, quantity), retailer)); }
    catch { failures++; offers.push({ ...summary(row, retailer), localStatus: 'lookup_failed' }); }
  }
  return { retailerId: retailer, evidence, status: failures === rows.length ? 'source_failed' : failures ? 'partial' : 'checked', offers };
}

export async function comparePrices(args, { compare = compareRetailPrices, sources = providers } = {}) {
  const { query, zipcode, retailer, retailers = retailerIds, includeGenerics } = schemas.prices.parse(args);
  if (!zipcode) return { status: 'requires_cep', reason: 'Os serviços de entrega e retirada verificam o CEP.' };
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
    result = await compare(reference, { zipcode, retailers: retailers.filter(id=>id!=='drogasil').map(id=>sources[id]), includeDrogasil:retailers.includes('drogasil'), includeGenerics });
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
  if (input.retailer === 'drogasil') {
    const data = await getMedicationInfo(input.queries,{scope:input.scope});
    return {...data, retailerId:input.retailer, page:input.page, limitPerQuery:input.limit,
      results:data.results.map(row => ({...row, products:/^\d+$/.test(row.query) ? row.products :
        row.products.slice((input.page-1)*input.limit,input.page*input.limit)}))};
  }
  return catalogInfo(input,sources[input.retailer]);
}
export const operations = { retailers: listRetailers, search: searchCatalog, suggest: suggestTerms, product: getProduct,
  stock: getStock, prices: comparePrices, info: medicationInfo,
  baskets: args => compareBaskets(args,providers),
  stores: async ({retailer,page,limit,zipcode,coordinates}) => {
    const source = providers[retailer];
    if (source.directoryScope === 'near_origin' && !zipcode && !coordinates) return {retailerId:retailer,status:'requires_origin',stores:[]};
    const all = retailer === 'drogasil' ? await source.stores() : await source.stores(coordinates??zipcode);
    return {retailerId:retailer, scope:source.directoryScope??'national', total:all.length, page, stores:all.slice((page-1)*limit,page*limit)};
  },
  compare: args => compareOffers(args, providers[args.retailer]),
  basket: args => retailerBasket(args, providers[args.retailer]),
  snapshot: args => startSnapshots(args,providers),
  read_snapshot: ({runId,...page}) => readSnapshot(runId,page) };
export async function request(operation, input) {
  if (!Object.hasOwn(operations, operation)) throw new TypeError('Operação desconhecida');
  return operations[operation](schemas[operation].parse(input));
}
