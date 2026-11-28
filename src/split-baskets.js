// Each block is an independently verified visit or a retailer's joint plan.
// Two separately quoted orders at the same branch cannot prove joint fulfillment.
const cents = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
const finiteDistance = stop => Number.isFinite(stop.distanceKm) ? stop.distanceKm : Infinity;

function stockBlocks(result, items) {
  const blocks = [];
  for (const plan of result.plans ?? []) {
    const stops = (plan.stops ?? []).map(stop => ({
      ...stop, retailerId:'drogasil', pickups:stop.pickups.map(pick => ({
        ...pick, item:result.tables.findIndex(t => t.label === pick.table), evidence:'reported_branch_stock',
      })),
    }));
    if (stops.length) blocks.push(stops);
  }
  for (const [i, table] of (result.tables ?? []).entries()) {
    if (table.needsSelection || !items[i]) continue;
    for (const product of table.rows ?? []) {
      const {store} = product;
      const packs = items[i].quantity ?? 1;
      if (!store?.id || !Number.isFinite(store.quantity) || store.quantity < packs) continue;
      blocks.push([{id:store.id, name:store.name, address:store.address, distanceKm:store.distanceKm,
        retailerId:'drogasil', pickups:[{item:i, name:product.name, sku:product.sku, type:product.type,
          packs, unitPriceBRL:product.referencePriceBRL, reportedStock:store.quantity, evidence:'reported_branch_stock'}]}]);
    }
  }
  return blocks;
}

function pickupMethods(product) {
  return (product.methods ?? []).filter(m => m.channel === 'pickup-in-point' && m.pickupPointId);
}

function pickupBlock(id, method, products, indices, items) {
  return [{retailerId:id, id:method.pickupPointId, name:method.branch, address:method.address,
    distanceKm:method.distanceKm, pickups:products.map((p,j) => ({
      item:indices[j], sku:p.sku, name:p.name, type:p.type, packs:items[indices[j]].quantity ?? 1,
      unitPriceBRL:p.currentPrice, reportedStock:null, evidence:'quoted_pickup',
    }))}];
}

function partnerBlocks(result, id, indices, items) {
  if (!indices.length) return [];
  const alternatives = result.planningScope === 'one_pack_alternatives' && indices.length === 1;
  const products = alternatives ? result.products : result.items;
  if (!Array.isArray(products) || !products.length) return [];
  const verified = (p,i) => p.localStatus === 'available' && p.requestedQuantity === (items[i].quantity ?? 1);
  if (alternatives) return products.filter(p => verified(p,indices[0]))
    .flatMap(p => pickupMethods(p).map(m => pickupBlock(id,m,[p],indices,items)));
  if (products.length !== indices.length || !products.every((p,j) => verified(p,indices[j]))) return [];
  // A repeated offer requires a combined quantity check. Two lines in one
  // checkout response can each repeat the same availability.
  if (new Set(products.map(p => p.sku)).size !== products.length) return [];
  const common = new Set((result.commonPickupPoints ?? []).map(p => p.id));
  return pickupMethods(products[0]).filter(m => indices.length === 1 || common.has(m.pickupPointId))
    .map(m => pickupBlock(id,m,products,indices,items));
}

async function collectPartnerBlocks(result, items, quoteSubset) {
  const id = result.retailerId;
  const indices = items.map((_,i) => i);
  const blocks = partnerBlocks(result,id,indices,items);
  const failures = [];
  // Repeated packs share stock. Verify their total before assigning several
  // lines to the same pickup point, keeping each original basket position.
  if (result.items?.length === items.length) {
    const groups = new Map();
    for (const [i,p] of result.items.entries()) {
      const group = groups.get(p.sku) ?? [];
      group.push(i);
      groups.set(p.sku,group);
    }
    if (groups.size < items.length && result.items.every(p => p.sku && p.sellerId)) {
      const grouped = [...groups.values()];
      const chosen = grouped.map(g => ({query:String(result.items[g[0]].sku),
        selectedSku:String(result.items[g[0]].sku),quantity:g.reduce((sum,i) => sum+(items[i].quantity ?? 1),0)}));
      try {
        const combined = await quoteSubset(id,grouped.map(g => g[0]),chosen);
        const quotes = combined.items ?? [];
        if (quotes.length === chosen.length && quotes.every((p,j) => p.sku === chosen[j].selectedSku &&
            grouped[j].every(i => result.items[i].sellerId === p.sellerId))) {
          for (const [stop] of partnerBlocks(combined,id,chosen.map((_,j)=>j),chosen)) {
            blocks.push([{...stop,pickups:stop.pickups.flatMap(pick => grouped[pick.item].map(i =>
              ({...pick,item:i,packs:items[i].quantity ?? 1})))}]);
          }
        }
      } catch { failures.push(indices); }
    }
  }
  const available = indices.filter(i => {
    const t = result.tables?.[i];
    return t && (t.status === 'matches' || t.status === 'partial' || t.status === 'incomplete_presentation') &&
      t.choices?.length > 0;
  });
  const quoteCache = new Map();
  const check = async subset => {
    const key = JSON.stringify(subset.map(i => items[i]));
    if (!quoteCache.has(key)) quoteCache.set(key,quoteSubset(id,subset));
    try {
      const quote = await quoteCache.get(key);
      if (['source_failed','unconfirmed','unverified','unresolved_items'].includes(quote.status)) failures.push(subset);
      blocks.push(...partnerBlocks(quote,id,subset,items));
    } catch { failures.push(subset); }
  };
  // For each chain check its locally resolvable part together as well as
  // separate visits. Bound additional outbound calls on long shopping lists.
  const limited = available.length > 12;
  if (available.length > 1 && available.length < items.length) await check(available);
  for (const i of available.slice(0,12)) await check([i]);
  return {blocks, failures, limited};
}

function bestPlans(blocks, count) {
  const byItem = Array.from({length:count},() => []);
  for (const stops of blocks) {
    const picks = stops.flatMap(s => s.pickups);
    const indices = picks.map(p => p.item);
    if (!indices.length || new Set(indices).size !== indices.length || indices.some(i => i < 0 || i >= count)) continue;
    const prices = picks.map(p => cents(p.unitPriceBRL));
    const cost = prices.includes(null) ? Infinity : prices.reduce((sum,price,i) => sum + price * picks[i].packs,0);
    const entry = {stops, indices, keys:stops.map(s => s.retailerId + ':' + s.id), cost};
    byItem[Math.min(...indices)].push(entry);
  }
  let fewest, cheapest, nodes = 0, limited = false;
  const ordered = (a,b) => {
    for (let i=0; i<a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  const usedItems = new Set(), usedStops = new Set(), selected = [];
  function visit(i,cost) {
    if (++nodes > 50000) { limited = true; return; }
    while (usedItems.has(i)) i++;
    if (i === count) {
      const stops = selected.flatMap(block => block.stops);
      // Individual distances only break ties; their sum is not an itinerary.
      const proximity = stops.reduce((sum,s) => sum + finiteDistance(s),0);
      const fewRank = [stops.length,proximity,cost], priceRank = [cost,stops.length,proximity];
      const plan = {stopCount:stops.length,totalBRL:Number.isFinite(cost) ? cost/100 : null,stops};
      if (!fewest || ordered(fewRank,fewest.rank)) fewest = {rank:fewRank,plan};
      if (Number.isFinite(cost) && (!cheapest || ordered(priceRank,cheapest.rank))) cheapest = {rank:priceRank,plan};
      return;
    }
    for (const block of byItem[i]) {
      if (limited) break;
      if (block.indices.some(j => usedItems.has(j)) || block.keys.some(k => usedStops.has(k))) continue;
      block.indices.forEach(j => usedItems.add(j));
      block.keys.forEach(k => usedStops.add(k));
      selected.push(block);
      visit(i+1,cost+block.cost);
      selected.pop();
      block.indices.forEach(j => usedItems.delete(j));
      block.keys.forEach(k => usedStops.delete(k));
    }
  }
  visit(0,0);
  return {fewest:fewest?.plan, cheapest:cheapest?.plan, limited};
}

export async function crossRetailerPlans(results, items, quoteSubset) {
  const reports = await Promise.all(results.map(async result => result.retailerId === 'drogasil'
    ? {blocks:stockBlocks(result,items), failures:[], limited:false}
    : collectPartnerBlocks(result,items,quoteSubset)));
  const {fewest,cheapest,limited} = bestPlans(reports.flatMap(r => r.blocks),items.length);
  const plans = [];
  if (fewest) plans.push({...fewest,objective:fewest === cheapest ? 'both' : 'fewest_stores'});
  if (cheapest && cheapest !== fewest) plans.push({...cheapest,objective:'lowest_price'});
  const comparison = cheapest && fewest?.totalBRL != null && fewest !== cheapest ? {
    savingsBRL:(cents(fewest.totalBRL)-cents(cheapest.totalBRL))/100,
    extraStops:cheapest.stopCount-fewest.stopCount,
  } : null;
  return {status:plans.length ? 'complete' : 'no_complete_plan_verified',
    scope:'verified_pickup_and_branch_plans',feesIncluded:false, plans, comparison,
    lookupFailures:reports.flatMap((r,j) => r.failures.map(itemIndices => ({retailerId:results[j].retailerId,itemIndices}))),
    searchLimited:limited || reports.some(r => r.limited)};
}
