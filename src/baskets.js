import { planPurchase, samePack } from 'drogasil-cli';
import { retailerBasket } from 'drogasil-cli/retailer-workflows';

export async function compareBaskets({items,retailers,zipcode}, sources, plan = planPurchase) {
  // The first selected retailer with a verified presentation supplies the identity
  // for each barcode. Each subsequent offer still has to match that physical pack.
  const anchors=new Map(), catalogs=new Map();
  const codes=[...new Set(items.map(item=>item.gtin))];
  for(const id of retailers) {
    const catalog=new Map();
    for(const gtin of codes) {
      try {
        const rows=(await sources[id].byGtin(gtin)).filter(r=>r.gtin===gtin && samePack(r,r));
        catalog.set(gtin,rows);
        if(!anchors.has(gtin) && rows.length && rows.every(row=>samePack(rows[0],row))) anchors.set(gtin,rows[0]);
      } catch { catalog.set(gtin,null); }
    }
    catalogs.set(id,catalog);
  }
  const results=[];
  for(const retailer of retailers) {
    const lines=[],pending=[];
    for(const {gtin,quantity,sellers} of items) {
      const rows=catalogs.get(retailer).get(gtin);
      const offers=rows?.filter(row=>anchors.has(gtin) && samePack(anchors.get(gtin),row) &&
        (!sellers?.[retailer] || row.sellerId===sellers[retailer]));
      if(offers?.length===1) lines.push({sku:offers[0].sku,sellerId:offers[0].sellerId,quantity});
      else pending.push({gtin,status:!rows?'source_failed':offers?.length?'choose_offer':'no_verified_pack',
        candidates:offers?.map(({sku,sellerId,seller})=>({sku,sellerId,seller}))??[]});
    }
    if(pending.length) { results.push({retailerId:retailer,status:'unresolved_items',pending});continue; }
    try {
      if(retailer==='drogasil') {
        const data=await plan(lines.map(({sku,quantity})=>({query:sku,selectedSku:sku,quantity,includeGenerics:false})),{origin:{zipcode}});
        results.push({retailerId:retailer,status:data.status,priceScope:'catalog_reference',plan:data});
      } else {
        const data=await retailerBasket({retailer,items:lines,zipcode},sources[retailer]);
        results.push({...data,priceScope:data.status==='fulfillable'?'verified_for_cep':'unconfirmed'});
      }
    } catch { results.push({retailerId:retailer,status:'source_failed'}); }
  }
  const ranked=results.filter(r=>r.status==='fulfillable' && Number.isFinite(r.estimatedProductTotalBRL))
    .sort((a,b)=>a.estimatedProductTotalBRL-b.estimatedProductTotalBRL);
  return {results,rankedProductSubtotals:ranked.map(({retailerId,estimatedProductTotalBRL})=>({retailerId,estimatedProductTotalBRL})),feesIncluded:false};
}
