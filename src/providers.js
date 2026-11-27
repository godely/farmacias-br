import {
  getProductsBySku, productInfo, searchProducts, searchStockWindows, stockQuantity,
} from 'drogasil-cli';
import { retailer as pagueMenos } from 'paguemenos-cli';
import { retailer as saoPaulo } from 'drogariasaopaulo-cli';
import { retailer as independente } from 'farmaciaindependente-cli';

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
  async search(query, page, limit) {
    return (await searchProducts(query, { page: page - 1, hitsPerPage: limit })).hits.map(catalogRow);
  },
  async product(sku) {
    return (await getProductsBySku([sku])).filter(Boolean).map(catalogRow);
  },
  async local(row, zipcode, quantity) {
    const { windows, coverage } = await searchStockWindows(new Map([[row.sku, quantity]]), { zipcode });
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

export const providers = { drogasil, paguemenos: pagueMenos, drogariasaopaulo: saoPaulo,
  farmaciaindependente: independente };
export const retailPartners = [pagueMenos, saoPaulo, independente];
