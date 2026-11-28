import { searchCatalogPage } from 'drogasil-cli/catalog-search';
import { isDcbName, medicationIntent } from 'drogasil-cli/medication-catalog';
import {
  getProductsBySku, listStores, productInfo, resolveMedication, searchProducts, searchStockWindows, stockQuantity,
} from 'drogasil-cli';
import { retailer as pagueMenos, searchVerifiedCatalog } from 'paguemenos-cli';
import { retailer as saoPaulo } from 'drogariasaopaulo-cli';

function catalogRow(hit) {
  const info = productInfo(hit);
  const validLink = hit.url && new URL(hit.url, 'https://www.drogasil.com.br');
  return {
    retailer: 'Drogasil', sku: String(hit.sku), gtin: hit.eanCode ? String(hit.eanCode) : null,
    name: hit.name, brand: hit.brand, type: info.type, pack: info.pack, facts: hit.details ?? {},
    productUrl: validLink?.origin === 'https://www.drogasil.com.br' ? validLink.href : null,
    currentPrice: info.referencePriceBRL ?? null, listPrice: null, currency: 'BRL', inStock: null,
    priceScope: 'catalog_reference', observedAt: new Date().toISOString(),
  };
}

const drogasil = {
  name: 'Drogasil',
  stores: listStores,
  async search(query, page, limit) {
    return (await searchProducts(query, { page: page - 1, hitsPerPage: limit })).hits.map(catalogRow);
  },
  async suggest(query, limit) {
    return (await medicationIntent(query)).suggestions.slice(0, limit);
  },
  async searchCatalog(query, page, limit) {
    return (await this.searchCatalogPage(query, page, limit)).products;
  },
  async searchCatalogPage(query, page, limit) {
    const result = await searchCatalogPage(query, {page:page - 1, hitsPerPage:limit});
    const products = result.hits.map(hit => ({
      ...catalogRow(hit), activeIngredients:hit.activeIngredients, ingredientEvidence:hit.ingredientEvidence,
    }));
    return {products, pages:result.nbPages};
  },
  async byGtin(gtin) {
    const {hits} = await searchProducts(gtin,{hitsPerPage:100});
    return hits.filter(hit => String(hit.eanCode) === gtin).map(catalogRow);
  },
  async product(sku) {
    return (await getProductsBySku([sku])).filter(Boolean).map(catalogRow);
  },
  async local(row, location, quantity, options = {}) {
    const { windows, coverage, expandedSearch } = await searchStockWindows(new Map([[row.sku, quantity]]), typeof location === 'string' ? { zipcode: location } : location, options);
    const branches = windows.get(row.sku).rows.map(item => ({
      id: String(item.branch.id), name: item.branch.businessName, address: item.branch.address,
      distanceKm: item.branch.distanceKMFromSearch, quantity: stockQuantity(item, row.sku),
    }));
    const enough = branches.some(branch => branch.quantity !== null && branch.quantity >= quantity);
    const known = branches.length > 0 && branches.every(branch => branch.quantity !== null);
    const shown = expandedSearch && !options.includeAll ? branches.filter(b => b.quantity >= quantity).slice(0,10) : branches;
    return { ...row, branches:shown, coverage, ...(expandedSearch && {expandedSearch}), requestedQuantity: quantity,
      localStatus: enough ? 'available' : known ? 'insufficient_stock' : 'unverified' };
  },
};

const nameKey = term => term.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Drug identity may corroborate a spelling. Only the target retailer can
// corroborate a presentation, SKU, price or stock.
export function withMedicationNames(source, resolve = resolveMedication, intentFor = medicationIntent) {
  return { ...source, async searchCatalog(query, page, limit) {
    return searchVerifiedCatalog(source, query, page, limit, intentFor);
  }, async suggest(query, limit = 7) {
    const [terms, name] = await Promise.all([
      source.suggest(query, Math.max(limit, 7)),
      resolve(query).catch(() => null),
    ]);
    // A literal DCB completion takes priority over a fuzzy brand (amoxic → amoxicilina).
    // Inspect only terms proposed by this retailer. A DCB alone establishes no local offer.
    const prefix = nameKey(query);
    const completion = terms.find(term => {
      const key = nameKey(term);
      return key !== prefix && key.startsWith(prefix) && isDcbName(key);
    });
    if (completion) return [completion, ...terms.filter(term => term !== completion)].slice(0, limit);
    const corrected = name?.interpretation?.interpreted;
    if (!corrected || !['ingredient', 'brand'].includes(name.kind)) return terms.slice(0, limit);
    const same = term => nameKey(term) === nameKey(corrected);
    let candidate = terms.find(same);
    if (!candidate) {
      // An English alias or a severe typo can be absent from autocomplete.
      // Require a strict catalog match before adding that interpretation.
      try {
        if ((await source.search(corrected, 1, 1)).length) candidate = corrected;
      } catch { /* The retailer's original suggestions remain usable. */ }
    }
    return candidate ? [candidate, ...terms.filter(term => !same(term))].slice(0, limit) : terms.slice(0, limit);
  } };
}

export const providers = { drogasil, paguemenos: withMedicationNames(pagueMenos), drogariasaopaulo: saoPaulo };
export const retailPartners = [pagueMenos, saoPaulo];
