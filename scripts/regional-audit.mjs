// TSV input: UF, municipality, CEP. Only regional outcome summaries go to stdout.
import { readFile } from 'node:fs/promises';
import { comparePrices, getStock } from '../src/index.js';
import assert from 'node:assert/strict';

const [input, sku] = process.argv.slice(2);
if (!input || !sku) throw new Error('Usage: node scripts/regional-audit.mjs origins.tsv DROGASIL_SKU');
const lines = (await readFile(input, 'utf8')).trim().split(/\r?\n/);
async function worker() {
  while (lines.length) {
    const [state, city, zipcode] = lines.shift().split('\t');
    try {
      const data = await comparePrices({ query: sku, zipcode });
      assert.equal(data.checkedRetailers.length, 4);
      const prices = data.verifiedOffers.map(r => r.currentPrice);
      assert.deepEqual(prices, [...prices].sort((a,b) => a-b));
      assert.ok(data.verifiedOffers.every(r => r.priceScope === 'verified_for_cep' && r.fulfillment.length && r.gtin === data.reference.gtin));
      assert.ok(data.onlineOffers.every(r => r.priceScope !== 'verified_for_cep' || !Number.isFinite(r.currentPrice)));
      const stock = await getStock({ retailer: 'drogasil', sku, zipcode });
      const coverage = stock.offers[0]?.coverage;
      assert.ok(coverage && Number.isSafeInteger(coverage.checkedStores));
      console.log(JSON.stringify({ state, city, coverage: coverage.checkedStores, locallyQuoted: prices.length,
        sources: Object.fromEntries(data.checkedRetailers.map(r => [r.retailer, r.status])), issues: data.issues }));
    } catch (error) {
      process.exitCode = 1;
      console.log(JSON.stringify({ state, city, error: error.message.split('\n')[0] }));
    }
  }
}
await Promise.all([worker(), worker()]);
