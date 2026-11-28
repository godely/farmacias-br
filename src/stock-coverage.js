// A checkout quote can verify pickup, but only explicit branch counts prove
// that the entire selected local search returned zero.
export function basketCoverage(results, fixed) {
  if (results.length === 1 && results[0].coverage) return results[0].coverage;
  const known = results.every(r => Number.isInteger(r.coverage?.checkedStores) && r.coverage.checkedStores > 0);
  const stockUnknown = !known || results.some(r => r.coverage.stockUnknown !== false || r.stockIncomplete);
  const allZero = !stockUnknown && results.every(r => r.coverage.allZero === true);
  return {checkedStores:known ? results.reduce((sum,r) => sum + r.coverage.checkedStores,0) : null,
    radiusKm:known && results.every(r => Number.isFinite(r.coverage.radiusKm))
      ? Math.min(...results.map(r => r.coverage.radiusKm)) : null,
    allZero, stockUnknown, canExpand:!fixed && allZero && results.some(r => r.coverage.canExpand === true)};
}

export function expandedBranches(results, attempted = false) {
  const windows = results.map(group=>group.expandedSearch ?? group.purchase?.expandedSearch);
  if (!attempted && !windows.some(Boolean)) return null;
  const stores = windows.flatMap((window,index) =>
    (window?.stores ?? []).map(store=>({...store,retailerId:results[index].retailerId})));
  const inRange = stores.filter(store=>Number.isFinite(store.distanceKm) && store.distanceKm >= 0 && store.distanceKm <= 25);
  inRange.sort((a,b)=>a.distanceKm-b.distanceKm || a.retailerId.localeCompare(b.retailerId) || String(a.id).localeCompare(String(b.id)));
  const partial = inRange.length !== stores.length || results.some((group,index)=>
    windows[index] ? windows[index].partial : group.status==='source_failed' ||
      !(group.coverage?.allZero && group.coverage.radiusKm >= 25));
  const counts = results.map((group,index) => windows[index]
    ? windows[index].checkedStores : group.coverage?.checkedStores);
  const checkedStores = counts.every(n => Number.isSafeInteger(n) && n >= 0)
    ? counts.reduce((sum,n) => sum+n,0) : null;
  return {radiusKm:25, checkedStores, partial, stores:inRange.slice(0,10), advice:'Ligue para a filial antes de sair para confirmar o estoque.'};
}
