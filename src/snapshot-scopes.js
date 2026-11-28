import { catalogSnapshot } from 'drogasil-cli/retailer-workflows';

export async function startSnapshots({retailer, retailers, queries, maxItems}, sources, collect = catalogSnapshot) {
  const start = id => collect({retailer:id, queries, maxItems}, sources[id]);
  if (retailer) return start(retailer);
  const runs = await Promise.all(retailers.map(async id => {
    try {
      return {retailerId:id, ...await start(id)};
    } catch {
      return {retailerId:id, state:'failed', error:'snapshot_start_failed'};
    }
  }));
  return {runs};
}
