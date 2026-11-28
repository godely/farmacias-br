import {z} from 'zod';
import {planPurchase, resolveMedication} from 'drogasil-cli';
import {tableLabel} from 'drogasil-cli/retailer-workflows';
import {quoteShoppingList} from 'paguemenos-cli/plan';
import {providers} from './providers.js';

const retailerId = z.enum(Object.keys(providers));
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
  const ids=args.retailers ?? [args.retailer ?? 'drogasil'];
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
    if (ids.length>1 && (line.selectedSku || (/^\d+$/.test(line.query) && ids.some(id=>!line.selectedSkus?.[id]))))
      issue('Um SKU pertence a uma rede. Informe o nome ou um SKU para cada rede selecionada.',path);
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
  const lines=items.map(({selectedSku,quantity=1,...rest})=>({...rest,sku:selectedSku,quantity}));
  return quoteShoppingList(id,providers[id],lines,origin.zipcode ?? origin,undefined,{store,expandSearch});
}

export async function planSelectedBaskets(args,{resolve=resolveMedication, plan=planAtRetailer}={}) {
  const {items,retailers,retailer}=args;
  const ids=retailers ?? [retailer ?? 'drogasil'];
  if (!retailers) return plan(ids[0],localItems(items,ids[0]),args);

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
      return {...result,retailerId:id};
    } catch {
      return {retailerId:id,status:'source_failed'};
    }
  }));
  const completeRetailers=results.filter(r=>r.status==='complete' || r.status==='fulfillable').map(r=>r.retailerId);
  return {scope:'whole_basket_per_retailer',completeRetailers,results};
}

export const purchaseDescription =
  'Check all named medications together after settling generic preferences for each brand. For a single chain use retailer. For a comparison send retailers and the complete basket in one call. A bare SKU belongs to one retailer. Preserve choices in selectedSkus by retailer when comparing chains. Show what each chain can fill. Use the two physical route plans only when present and identify catalog estimates separately from local checkout subtotals. A whole-basket checkout has a common pickup location only when commonPickupPoints lists it. For a fixed closest branch send store nearest. Use expandSearch only after consent.';
