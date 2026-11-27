import { z } from 'zod';
import { compareRetailPrices } from 'drogasil-cli';
import { providers, retailPartners } from './providers.js';

export const retailerIds = Object.keys(providers);
const retailer = z.enum(retailerIds);
const sku = z.string().trim().regex(/^\d{1,20}$/);
const zipcode = z.string().trim().regex(/^\d{5}-?\d{3}$/).refine(value => !/^0+-?0+$/.test(value), 'CEP inválido');
const query = z.string().trim().min(1).max(150);
export const schemas = {
  retailers: z.strictObject({}),
  search: z.strictObject({ query, retailer: retailer.optional(), page: z.number().int().min(1).max(100).default(1),
    limit: z.number().int().min(1).max(50).default(10) }),
  product: z.strictObject({ retailer, sku }),
  stock: z.strictObject({ retailer, sku, zipcode, quantity: z.number().int().min(1).max(1000).default(1) }),
  prices: z.strictObject({ query, zipcode, retailer: retailer.optional().describe('Retailer owning the numeric SKU in query'),
    includeGenerics: z.boolean().default(false) }),
};
const stockEvidence = { drogasil: 'branch_quantity', paguemenos: 'fulfillment_quote',
  drogariasaopaulo: 'fulfillment_quote', farmaciaindependente: 'municipal_branch_stock_band' };

export function listRetailers() {
  return retailerIds.map(id => ({ id, retailer: providers[id].name, stockEvidence: stockEvidence[id],
    priceEvidence: stockEvidence[id] === 'fulfillment_quote' ? 'cep_quote_if_fulfillable' : 'online_or_reference' }));
}

function labeled(row, id) {
  return { ...row, retailerId: id, type: row.type ?? (/\bgen[eé]ric[oa]\b/i.test(row.name) ? 'Genérico' : 'Não informado') };
}
function summary(row, id) {
  const { facts, ...fields } = labeled(row, id);
  return fields;
}

export async function searchCatalog(args, sources = providers) {
  const { query, retailer, page, limit } = schemas.search.parse(args);
  const ids = retailer ? [retailer] : retailerIds;
  const results = await Promise.all(ids.map(async id => {
    try {
      const rows = await sources[id].search(query, page, limit);
      return { retailerId: id, status: rows.length ? 'matches' : 'no_match',
        products: rows.map(row => summary(row, id)) };
    } catch {
      return { retailerId: id, status: 'source_failed', products: [] };
    }
  }));
  return { page, limitPerRetailer: limit, results };
}

export async function getProduct(args, sources = providers) {
  const { retailer, sku } = schemas.product.parse(args);
  const rows = await sources[retailer].product(sku);
  return { retailerId: retailer, status: rows.length ? 'matches' : 'unknown_sku',
    products: rows.map(row => labeled(row, retailer)) };
}

export async function getStock(args, sources = providers) {
  const { retailer, sku, zipcode, quantity } = schemas.stock.parse(args);
  const source = sources[retailer];
  const evidence = stockEvidence[retailer];
  if (source.serves && !await source.serves(zipcode)) {
    return { retailerId: retailer, evidence, status: 'outside_local_directory', offers: [] };
  }
  const rows = await source.product(sku);
  if (!rows.length) return { retailerId: retailer, evidence, status: 'unknown_sku', offers: [] };
  const offers = [];
  let failures = 0;
  for (const row of rows) {
    try { offers.push(summary(await source.local(row, zipcode, quantity), retailer)); }
    catch { failures++; offers.push({ ...summary(row, retailer), localStatus: 'lookup_failed' }); }
  }
  return { retailerId: retailer, evidence, status: failures === rows.length ? 'source_failed' : failures ? 'partial' : 'checked', offers };
}

export async function comparePrices(args) {
  const { query, zipcode, retailer, includeGenerics } = schemas.prices.parse(args);
  let reference = query;
  if (retailer) {
    const product = await getProduct({ retailer, sku: query });
    if (!product.products.length) return product;
    const codes = [...new Set(product.products.map(row => row.gtin).filter(Boolean))];
    if (codes.length !== 1) return { status: 'unconfirmed_gtin', reference: product };
    reference = codes[0];
  }
  return compareRetailPrices(reference, { zipcode, retailers: retailPartners, includeGenerics });
}

export const operations = { retailers: listRetailers, search: searchCatalog, product: getProduct,
  stock: getStock, prices: comparePrices };
export async function request(operation, input) {
  if (!Object.hasOwn(operations, operation)) throw new TypeError('Operação desconhecida');
  return operations[operation](schemas[operation].parse(input));
}
