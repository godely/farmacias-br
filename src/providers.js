import { isDcbName, medicationIntent, verifiedRow } from 'drogasil-cli/medication-catalog';
import {
  compareProducts, getProductsBySku, listStores, medicationSearch, productInfo, resolveMedication, searchProducts, searchStockWindows, stockQuantity,
} from 'drogasil-cli';
import { retailer as pagueMenos } from 'paguemenos-cli';
import { retailer as saoPaulo } from 'drogariasaopaulo-cli';

function catalogRow(hit) {
  const info = productInfo(hit);
  const validLink = hit.url && new URL(hit.url, 'https://www.drogasil.com.br');
  return {
    retailer: 'Drogasil', sku: String(hit.sku), gtin: hit.eanCode ? String(hit.eanCode) : null,
    name: hit.name, brand: hit.brand, type: info.type, facts: hit.details ?? {},
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
    const intent = await medicationIntent(query);
    const explicitForm = /\b(?:gotas?|comprimidos?|capsulas?|sublingual|efervescente|liberacao)\b/.test(intent.suffix);
    if (!['ingredient', 'brand'].includes(intent.kind) && !explicitForm) return this.search(query, page, limit);
    const name = await resolveMedication(query).catch(() => null);
    const options = {page: page - 1, hitsPerPage: limit};
    // Facets verify identity and leave every page available at the requested size.
    // Some DCB entries have no catalog facet. Verify their structured ingredients.
    const hasFacet = name?.kind === intent.kind && name.filters && !name.interpretation;
    let hits;
    const checkPresentation = explicitForm || (hasFacet && intent.suffix);
    if (checkPresentation) {
      const result = await compareProducts(query, {resolveNames:true, includeGenerics:false, includeUnpriced:true});
      const matches = result.candidates ?? result.groups?.flat() ?? result.products ?? [];
      hits = matches.slice((page - 1) * limit, page * limit);
    } else {
      const result = hasFacet ? await medicationSearch(query, options, name) : await searchProducts(query, options);
      hits = result.hits;
    }
    return hits.flatMap(hit => {
      const row = catalogRow(hit);
      const ingredients = (hit.details?.activeIngredients ?? []).map(item => item.description).filter(Boolean);
      const verified = verifiedRow(row, (checkPresentation || hasFacet) ? {...intent, suffix:''} : intent, {
        ingredients, evidence: {source: 'retailer_field'},
      });
      return verified ? [verified] : [];
    });
  },
  async byGtin(gtin) {
    const {hits} = await searchProducts(gtin,{hitsPerPage:100});
    return hits.filter(hit => String(hit.eanCode) === gtin).map(catalogRow);
  },
  async product(sku) {
    return (await getProductsBySku([sku])).filter(Boolean).map(catalogRow);
  },
  async local(row, location, quantity) {
    const { windows, coverage } = await searchStockWindows(new Map([[row.sku, quantity]]), typeof location === 'string' ? { zipcode: location } : location);
    const branches = windows.get(row.sku).rows.map(item => ({
      id: String(item.branch.id), name: item.branch.businessName, address: item.branch.address,
      distanceKm: item.branch.distanceKMFromSearch, quantity: stockQuantity(item, row.sku),
    }));
    const enough = branches.some(branch => branch.quantity !== null && branch.quantity >= quantity);
    const known = branches.length > 0 && branches.every(branch => branch.quantity !== null);
    return { ...row, branches, coverage, requestedQuantity: quantity,
      localStatus: enough ? 'available' : known ? 'insufficient_stock' : 'unverified' };
  },
};

const nameKey = term => term.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Drug identity may corroborate a spelling. Only the target retailer can
// corroborate a presentation, SKU, price or stock.
export function withMedicationNames(source, resolve = resolveMedication, intentFor = medicationIntent) {
  return { ...source, async searchCatalog(query, page, limit) {
    const [rows, intent] = await Promise.all([source.search(query, page, limit), intentFor(query)]);
    if (intent.kind !== 'ingredient') return rows;
    return rows.flatMap(row => {
      const field = 'NomeSubstanciaPrincipioAtivo';
      // The retailer sometimes fills this field with the class “Antimicrobiano”
      // alone or before the actual ingredient. Keep other field values authoritative.
      const ingredients = [row.facts?.[field]].flat().filter(value => typeof value === 'string')
        .flatMap(value => value.split(/[,;]/)).map(value => value.trim())
        .filter(value => value && !/^antimicrobianos?$/iu.test(value));
      const verified = verifiedRow(row, intent, {ingredients, evidence:{source:'retailer_field', field}});
      return verified ? [verified] : [];
    });
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
