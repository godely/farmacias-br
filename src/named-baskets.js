import {z} from 'zod';
import {planPurchase, resolveMedication} from 'drogasil-cli';
import {quoteChosenOffers,quoteShoppingList,shoppingSource} from 'paguemenos-cli/plan';
import {fixedStoreSource} from 'paguemenos-cli/compare';
import {crossRetailerPlans} from 'paguemenos-cli/pickup-plans';
import {providers} from './providers.js';
import {nameChoices, choiceFollowup} from './name-choices.js';

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

async function planAtRetailer(id,items,{origin,store,expandSearch,includeBranchChoices,fixedOffers},source=providers[id]) {
  if (id==='drogasil') return planPurchase(items,{origin,store,expandSearch,includeBranchChoices,confirmBrands:true});
  if (expandSearch) return {
    retailerId:id, status:'branch_inventory_unverified',
    reason:'A rede confirma retirada para a quantidade pedida. O estoque físico de cada filial é desconhecido.',
  };
  if (fixedOffers) return quoteChosenOffers(id,source,items,origin.zipcode ?? origin);
  const lines=items.map(({selectedSku,quantity=1,...rest})=>({...rest,sku:selectedSku,quantity}));
  return quoteShoppingList(id,source,lines,origin.zipcode ?? origin);
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
      ...(product.pickupAtStore && {pickupAtStore:product.pickupAtStore}),
      branchQuantity:null, closestPickupPointId:product.closestQuotedPickup?.pickupPointId ?? null, methods};
  });
  return {...summary, tables:tables.map(table => ({...table, choices})), pickupPoints:[...pickupPoints.values()]};
}

export async function planSelectedBaskets(args,{resolve=resolveMedication, plan:customPlan, clarify=nameChoices, providers:retailersById=providers}={}) {
  const {items,retailer}=args;
  const ids=selectedRetailers(args);
  const sources = new Map();
  const storeEvidence = (id, result) => sources.get(id)?.withStoreEvidence?.(result) ?? result;
  const plan = customPlan ?? (async (id,lines,options) => {
    if (!sources.has(id)) {
      const source = shoppingSource(retailersById[id]);
      sources.set(id, options.store && id !== 'drogasil'
        ? fixedStoreSource(id, source, options.origin.zipcode ?? options.origin, options.store) : source);
    }
    const result = await planAtRetailer(id,lines,options,sources.get(id));
    return storeEvidence(id,result);
  });
  if (ids.length > 1 && items.some(line => line.selectedSku ||
      (/^\d+$/.test(line.query) && ids.some(id => !line.selectedSkus?.[id])))) {
    return {status:'requires_retailer', question:'De qual farmácia é esse produto?', results:[]};
  }
  for (const [index, line] of items.entries()) {
    if (line.selectedSku || ids.every(id => line.selectedSkus?.[id]) || /^\d+$/.test(line.query)) continue;
    const choices = await clarify(line.query);
    if (!choices.length) continue;
    const followup = query => ({...args, items:items.map((item, i) => i === index ? {...item, query} : item)});
    const scope = retailer ? {retailer} : {retailers:ids};
    const resolution = choiceFollowup(choices, 'plan_purchase', followup, {...scope, query:line.query});
    return {status:'needs_name_confirmation', label:tableLabel(index), ...resolution, results:[]};
  }
  const planPickups = items.length > 1 && !args.expandSearch;
  const quoteSubset = (id,indices,chosen) => chosen ? plan(id,chosen,{...args,fixedOffers:true}) :
    plan(id,localItems(indices.map(i=>items[i]),id),args);
  if (retailer) {
    const result = await plan(retailer,localItems(items,retailer),args);
    if (retailer === 'drogasil' || !planPickups || result.pendingBrands) return result;
    const pickupPlans = await crossRetailerPlans([{...result,retailerId:retailer}],items,quoteSubset);
    return storeEvidence(retailer,{...result,pickupPlans});
  }

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
      const includeBranchChoices=id==='drogasil' && ids.length>1 && items.length>1 && !args.store && !args.expandSearch;
      const result=await plan(id,localItems(items,id),{...args,includeBranchChoices});
      return {...result, retailerId:id};
    } catch {
      return {retailerId:id,status:'source_failed'};
    }
  }));
  const comparison = planPickups && (ids.length > 1 || ids[0] !== 'drogasil')
    ? await crossRetailerPlans(results,items,quoteSubset) : undefined;
  const summaries = await Promise.all(results.map(async ({branchChoices,...result}) => {
    const pickupPlans = result.retailerId === 'drogasil' ? undefined :
      (ids.length === 1 ? comparison : comparison?.byRetailer[result.retailerId]);
    return compactPartnerAlternatives(await storeEvidence(result.retailerId,{...result,...(pickupPlans && {pickupPlans})}));
  }));
  const completeRetailers=summaries.filter(r=>r.status==='complete' || r.status==='fulfillable' ||
    r.pickupPlans?.status==='complete').map(r=>r.retailerId);
  const {byRetailer,...overall} = comparison ?? {};
  return {scope:'whole_basket_per_retailer', checkedRetailers:ids, completeRetailers,
    results:summaries, ...(ids.length > 1 && comparison && {crossRetailerPlans:overall})};
}

export const purchaseDescription =
  'For local shopping and stock use plan_purchase once for the entire named basket after generic preferences are settled. Send the names as given, including brand and presentation. This tool resolves all products and obtains the checkout quotes itself. Make it the first shopping call, including for a refresh or an item preference from a previous table. ' +
  'No pharmacy named or “qualquer uma” means all three: omit retailer and retailers. Use retailer only for a chain the shopper actually chose, and retailers for a chosen group. ' +
  'Keep that scope through clarification of pack size, dose, and generic preferences. A catalog used for clarification does not set the shopping scope. ' +
  'For “na minha loja mais próxima” set store to nearest and check one directory branch per selected chain. Use fixedStore for the branch identity and pickupAtStore for the outcome. A missing pickup offer at that store does not establish zero units. Once a fixed branch is checked, answer for it and finish. Check additional branches only if the shopper asks for them. For the nearest place offering pickup omit store. ' +
  'Use the manufacturer as supplied, including a short name such as “Prati”, when the shopper specifically requests it. On choose_manufacturer, ask which of the returned manufacturer names they mean. Preserve one item per requested medication, with brand choices and quantity. Retain local product selections by retailer in selectedSkus. ' +
  'For a multi-chain basket lead with a complete crossRetailerPlans plan, naming each store and what to pick up there. Empty completeRetailers only concerns each chain alone. When two plans differ, show the savings and extra stops. Compare verified product subtotals. '+
  'When a basket is incomplete, identify the item and each chain’s lookup outcome. A catalog miss leaves local stock unknown. For a multi-chain result use every retailer result including failures. For one partner chain lead with pickupPlans for its verified stores. Compare fewest stores and lowest product subtotal. Report searchLimited or failed quotes as partial coverage. Drogasil reports branch quantities. Partner checkout confirms pickup for the requested packs.';
