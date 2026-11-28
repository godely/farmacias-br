import {z} from 'zod';
import {planPurchase, resolveMedication} from 'drogasil-cli';
import {quoteShoppingList} from 'paguemenos-cli/plan';
import {crossRetailerPlans} from './split-baskets.js';
import {providers} from './providers.js';

const allRetailers = Object.keys(providers);

export function tableLabel(index) {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + (n - 1) % 26) + label;
  }
  return label;
}

function selectedRetailers({retailer, retailers}) {
  return retailers ?? (retailer ? [retailer] : allRetailers);
}

const retailerId = z.enum(allRetailers);
const sku = z.string().regex(/^\d+$/);
const origin = z.union([
  z.strictObject({zipcode:z.string().regex(/^\d{5}-?\d{3}$/).refine(s=>!/^0+-?0+$/.test(s))}),
  z.strictObject({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}),
]);
const item = z.object({
  query:z.string().trim().min(1), quantity:z.number().int().positive().optional(),
  selectedSku:sku.optional(), selectedSkus:z.partialRecord(retailerId,sku).optional()
    .describe('Local SKU by retailer for preferences retained from an earlier result.'),
  includeGenerics:z.boolean().optional(), genericOnly:z.boolean().optional(), brand:z.string().trim().min(1).optional(),
});

export const purchaseSchema = z.strictObject({
  retailer:retailerId.optional(), retailers:z.array(retailerId).min(1).max(3).optional(),
  origin, items:z.array(item).min(1), store:z.literal('nearest').optional(),
  expandSearch:z.boolean().optional().describe('Use after the user accepts the wider search.'),
}).superRefine((args,ctx)=>{
  const ids=selectedRetailers(args);
  const issue=(message,path)=>ctx.addIssue({code:'custom',message,path});
  if (args.retailer && args.retailers) issue('Use retailer ou retailers.', ['retailers']);
  if (new Set(ids).size!==ids.length) issue('Rede repetida.', ['retailers']);
  if (args.store && args.expandSearch) issue('A consulta a uma filial fixa não admite ampliação.', ['store']);
  for (const [i,line] of args.items.entries()) {
    const path=['items',i];
    if (line.genericOnly && (line.brand || line.includeGenerics===false))
      issue('Preferências de marca e genérico incompatíveis.', path);
    if (line.selectedSku && line.selectedSkus) issue('Escolha apenas um formato de seleção de SKU.',path);
    if (Object.keys(line.selectedSkus ?? {}).some(id=>!ids.includes(id))) issue('SKU de rede fora da seleção.',path);
  }
});

function localItems(items,id) {
  return items.map(({selectedSkus,selectedSku,...line})=>{
    const chosen=selectedSkus?.[id] ?? selectedSku;
    return {...line,...(chosen && {selectedSku:chosen}),...(/^\d+$/.test(line.query) && selectedSkus?.[id] && {query:chosen})};
  });
}

async function planAtRetailer(id,items,{origin,store,expandSearch}) {
  if (id==='drogasil') return planPurchase(items,{origin,store,expandSearch,confirmBrands:true});
  if (store || expandSearch) return {
    retailerId:id, status:'branch_inventory_unverified',
    reason:'A rede confirma retirada para a quantidade pedida. O estoque físico de cada filial é desconhecido.',
  };
  const lines=items.map(({selectedSku,quantity=1,...rest})=>({...rest,sku:selectedSku,quantity}));
  return quoteShoppingList(id,providers[id],lines,origin.zipcode ?? origin);
}

// Different products frequently quote the same pickup points. Keep every quote
// with its fee, and include the address of each pickup point only once.
export function compactPartnerAlternatives(result) {
  if (result.planningScope !== 'one_pack_alternatives') return result;
  const {products, tables, ...summary} = result;
  const pickupPoints = new Map();
  const choices = products.map(product => {
    const {sku, gtin, sellerId, seller, name, type, currentPrice, listPrice, currency,
      productUrl, priceScope, observedAt, localStatus, requestedQuantity, matchBasis} = product;
    const methods = product.methods.map(method => {
      if (method.channel !== 'pickup-in-point' || !method.pickupPointId) return method;
      const {pickupPointId, branch, address, distanceKm, ...quote} = method;
      if (!pickupPoints.has(pickupPointId)) pickupPoints.set(pickupPointId, {pickupPointId, branch, address, distanceKm});
      return {...quote, pickupPointId};
    });
    return {sku, gtin, sellerId, seller, name, type, currentPrice, listPrice, currency,
      productUrl, priceScope, observedAt, localStatus, requestedQuantity, matchBasis,
      branchQuantity:null, closestPickupPointId:product.closestQuotedPickup?.pickupPointId ?? null, methods};
  });
  return {...summary, tables:tables.map(table => ({...table, choices})), pickupPoints:[...pickupPoints.values()]};
}

export async function planSelectedBaskets(args,{resolve=resolveMedication, plan=planAtRetailer}={}) {
  const {items,retailer}=args;
  const ids=selectedRetailers(args);
  if (ids.length > 1 && items.some(line => line.selectedSku ||
      (/^\d+$/.test(line.query) && ids.some(id => !line.selectedSkus?.[id])))) {
    return {status:'requires_retailer', question:'De qual farmácia é esse produto?', results:[]};
  }
  if (retailer) return plan(ids[0],localItems(items,ids[0]),args);

  const pendingBrands=[];
  for (const [i,line] of items.entries()) {
    if (line.includeGenerics!==undefined || line.brand || line.genericOnly || line.selectedSku ||
        ids.every(id=>line.selectedSkus?.[id]) || /^\d+$/.test(line.query)) continue;
    const name=await resolve(line.query);
    if (name.kind==='brand') pendingBrands.push({label:tableLabel(i),name:name.name});
  }
  if (pendingBrands.length) return {status:'needs_generic_preference',pendingBrands,results:[]};

  const results=await Promise.all(ids.map(async id=>{
    try {
      const result=await plan(id,localItems(items,id),args);
      return {...result, retailerId:id};
    } catch {
      return {retailerId:id,status:'source_failed'};
    }
  }));
  const completeRetailers=results.filter(r=>r.status==='complete' || r.status==='fulfillable').map(r=>r.retailerId);
  const comparison = ids.length > 1 && items.length > 1 && !args.store && !args.expandSearch
    ? await crossRetailerPlans(results,items,(id,indices,combined) =>
        plan(id,combined ?? localItems(indices.map(i => items[i]),id),args)) : undefined;
  return {scope:'whole_basket_per_retailer', checkedRetailers:ids, completeRetailers,
    results:results.map(compactPartnerAlternatives), ...(comparison && {crossRetailerPlans:comparison})};
}

export const purchaseDescription =
  'For local shopping and stock use plan_purchase once for the entire named basket after generic preferences are settled. ' +
  'No pharmacy named or “qualquer uma” means all three: omit retailer and retailers. Use retailer only for a chain the shopper actually chose, and retailers for a chosen group. ' +
  'Keep that scope through clarification of pack size, dose, and generic preferences. A catalog used for clarification does not set the shopping scope. ' +
  'Preserve one item per requested medication, with brand choices and quantity. Retain local product selections by retailer in selectedSkus. ' +
  'For a multi-chain basket lead with a complete crossRetailerPlans plan, naming each store and what to pick up there. Empty completeRetailers only concerns each chain alone. When two plans differ, show the savings and extra stops. Compare verified product subtotals. '+
  'For a multi-chain result use every retailer result including failures. Drogasil reports branch quantities and trip plans. The partners report local checkout and pickup evidence.';
