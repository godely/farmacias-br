import {samePack} from 'drogasil-cli';
import {validGtin} from 'paguemenos-cli/vtex';
import {compareOffers} from 'paguemenos-cli/compare';
import {providers} from './providers.js';
import {basketCoverage, expandedBranches} from './stock-coverage.js';

function closestBranch(results) {
  const branches = results.map(group => ({retailerId:group.retailerId, ...group.fixedStore?.branch}));
  if (!branches.every(branch => Number.isFinite(branch.distanceKm))) return {status:'unconfirmed', branches:[]};
  const distance = Math.min(...branches.map(branch => branch.distanceKm));
  return {status:'identified', branches:branches.filter(branch => branch.distanceKm === distance)};
}

async function exactReference(owner, query, sources) {
  const products = await sources[owner].product(query);
  if (!products.length) return {status:'unknown_sku'};
  const anchor = products[0];
  if (!products.every(row => samePack(anchor, row))) return {status:'incomplete_presentation'};
  return {anchor};
}

function localReference(rows, anchor) {
  if (rows === null) return {status:'source_failed'};
  if (!rows.length) return {status:'no_exact_match'};
  if (!anchor || !rows.every(row => samePack(anchor, row))) return {status:'presentation_unconfirmed'};
  if (new Set(rows.map(row => row.sku)).size !== 1) return {status:'choose_reference',
    candidates:rows.map(({sku,name,type})=>({sku,name,type}))};
  return {query:rows[0].sku};
}

async function referenceQueries(query, ids, owner, sources) {
  const references = new Map(ids.map(id => [id, {query}]));
  if (!/^\d+$/.test(query)) return {references};
  const barcode = !owner && validGtin(query);
  if (!barcode && ids.length===1 && (!owner || owner===ids[0])) return {references};
  let anchor;
  if (!barcode) {
    if (!owner) return {status:'requires_retailer', question:'De qual farmácia é o produto que você indicou?'};
    let identity;
    try { identity = await exactReference(owner, query, sources); }
    catch { identity = {status:'source_failed'}; }
    if (!identity.anchor) return {...identity, referenceRetailer:owner};
    anchor = identity.anchor;
  }
  const gtin = anchor?.gtin ?? query;
  const targets = ids.filter(id => id !== owner);
  const catalogs = await Promise.all(targets.map(async id => {
    try { return (await sources[id].byGtin(gtin)).filter(row=>row.gtin===gtin); }
    catch { return null; }
  }));
  if (!anchor) {
    const packs = catalogs.filter(rows => rows?.length && rows.every(row => samePack(rows[0],row))).map(rows=>rows[0]);
    if (packs.length && packs.every(row => samePack(packs[0],row))) anchor = packs[0];
  }
  targets.forEach((id,index) => references.set(id,localReference(catalogs[index],anchor)));
  return {references};
}

export async function compareSelection(args, {sources=providers, comparePartner=compareOffers}={}) {
  const {retailer:owner, retailers, ...options} = args;
  const ids = retailers ?? (owner ? [owner] : Object.keys(sources));
  const grouped = Boolean(retailers || !owner);
  const {references, ...unresolved} = await referenceQueries(options.query, ids, owner, sources);
  if (!references) return {...unresolved, retailers:ids, results:[]};

  // A wider stock search must keep the same product at each retailer.
  async function lookup(id, expandSearch) {
    try {
      const ref = references.get(id);
      if (!ref.query) return {retailerId:id, ...ref, products:[]};
      const input = {...options, retailer:id, query:ref.query, expandSearch};
      const result = id === 'drogasil' ? await sources[id].compare(input) : await comparePartner(input, sources[id]);
      return { ...result, retailerId:id };
    } catch { return {retailerId:id, status:'source_failed', products:[]}; }
  }
  const multi = ids.length > 1;
  let results = await Promise.all(ids.map(id => lookup(id, multi ? false : options.expandSearch)));
  if (!grouped) return results[0];

  const location = options.zipcode || options.coordinates;
  const coverageFor = groups => basketCoverage(groups.map(group => ({
    coverage:group.coverage ?? group.purchase?.coverage, stockIncomplete:group.stockIncomplete ?? group.purchase?.stockIncomplete,
  })), options.store);
  let coverage = location ? coverageFor(results) : null;
  const expandEligible = multi && options.expandSearch && coverage?.canExpand;
  if (expandEligible) {
    results = await Promise.all(results.map(group => (group.coverage ?? group.purchase?.coverage)?.canExpand
      ? lookup(group.retailerId, true) : group));
    coverage = coverageFor(results);
  }
  const expandedSearch = expandedBranches(results,expandEligible);
  if (coverage && expandedSearch) {
    coverage = {...coverage, canExpand:false};
  }
  const failures = results.filter(group => group.status === 'source_failed').length;
  const partial = results.some(group => group.status==='partial');
  return {retailers:ids, status:failures===ids.length ? 'source_failed' : failures || partial ? 'partial' : 'checked',
    results, ...(coverage && {coverage}), ...(expandedSearch && {expandedSearch}), ...(options.store==='nearest' && {nearestAmongSelected:closestBranch(results)})};
}
