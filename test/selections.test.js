import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCatalog, comparePrices, retailerIds } from '../src/index.js';
import { compareBaskets } from '../src/baskets.js';
const gtin='7899547543766', zipcode='01001000';
for(let mask=1;mask<8;mask++) {
  const retailers=retailerIds.filter((_,i)=>mask&(1<<i));
  test('selected search, price sources and complete basket: '+retailers.join(', '),async()=>{
    const searched=[],resolved=[],quoted=[];
    const sources=Object.fromEntries(retailerIds.map((id,i)=>{
      const row={gtin,sku:String(i+1),name:'Exemplo 750 mg 20 comprimidos',sellerId:'1',currentPrice:10-i};
      return [id,{name:id,search:async()=>{searched.push(id);return [row]},byGtin:async()=>{resolved.push(id);return [row]},
        product:async sku=>{assert.equal(sku,row.sku);return [row]},
        basket:async lines=>{quoted.push(id);return lines.map(l=>({...row,requestedQuantity:l.quantity,localStatus:'available',methods:[]}));}}];
    }));
    await searchCatalog({query:'Exemplo',retailers},sources,async () => []);
    assert.deepEqual(searched,retailers);
    await comparePrices({query:gtin,retailers,zipcode},{sources,compare:async (_,opts)=>{
      assert.equal(opts.includeDrogasil,retailers.includes('drogasil'));
      assert.deepEqual(opts.retailers.map(p=>p.name),retailers.filter(id=>id!=='drogasil'));
      return {status:'matched'};
    }});
    const d=await compareBaskets({items:[{gtin,quantity:2}],retailers,zipcode},sources,async items=>{
      quoted.push('drogasil');
      assert.deepEqual(items,[{query:'1',selectedSku:'1',quantity:2}]);
      return {status:'complete',plans:[]};
    });
    assert.deepEqual(resolved,retailers); assert.deepEqual(quoted,retailers);
    assert.deepEqual(d.results.map(r=>r.retailerId),retailers);
    assert.deepEqual(d.rankedProductSubtotals.map(r=>r.retailerId),retailers.filter(id=>id!=='drogasil').reverse());
  });
}
