import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCatalog, comparePrices, retailerIds, schemas } from '../src/index.js';
import { compareBaskets } from '../src/baskets.js';
const gtin='7899547543766', zipcode='01001000';
for(let mask=1;mask<8;mask++) {
  const retailers=retailerIds.filter((_,i)=>mask&(1<<i));
  for (const location of [{zipcode}, {coordinates:{latitude:0, longitude:-44}}]) {
    const origin = location.coordinates ?? zipcode;
    const priceScope = location.coordinates ? 'verified_for_coordinates' : 'verified_for_cep';
    test(priceScope+' selected search, price sources and complete basket: '+retailers.join(', '),async()=>{
      const searched=[],resolved=[],quoted=[];
      const sources=Object.fromEntries(retailerIds.map((id,i)=>{
        const row={gtin,sku:String(i+1),name:'Exemplo 750 mg 20 comprimidos',sellerId:'1',currentPrice:10-i};
        return [id,{name:id,search:async()=>{searched.push(id);return [row]},byGtin:async()=>{resolved.push(id);return [row]},
          product:async sku=>{assert.equal(sku,row.sku);return [row]},
          basket:async (lines,place)=>{assert.deepEqual(place,origin);quoted.push(id);return lines.map(l=>({...row,priceScope,requestedQuantity:l.quantity,localStatus:'available',methods:[]}));}}];
      }));
      await searchCatalog({query:'Exemplo',retailers},sources,async () => []);
      assert.deepEqual(searched,retailers);
      await comparePrices({query:gtin,retailers,...location},{sources,compare:async (_,opts)=>{
        assert.deepEqual(opts.coordinates ?? opts.zipcode,origin);
        assert.equal(opts.includeDrogasil,retailers.includes('drogasil'));
        assert.deepEqual(opts.retailers.map(p=>p.name),retailers.filter(id=>id!=='drogasil'));
        return {status:'matched'};
      }});
      const d=await compareBaskets({items:[{gtin,quantity:2}],retailers,...location},sources,async (items,options)=>{
        assert.deepEqual(options.origin,location.coordinates ?? {zipcode});
        quoted.push('drogasil');
        assert.deepEqual(items,[{query:'1',selectedSku:'1',quantity:2}]);
        return {status:'complete',plans:[]};
      });
      assert.deepEqual(resolved,retailers); assert.deepEqual(quoted,retailers);
      assert.deepEqual(d.results.map(r=>r.retailerId),retailers);
      assert.ok(d.results.every(r=>r.priceScope===(r.retailerId==='drogasil'?'catalog_reference':priceScope)));
      assert.deepEqual(d.rankedProductSubtotals.map(r=>r.retailerId),retailers.filter(id=>id!=='drogasil').reverse());
    });
  }
}

test('price and basket requests require exactly one complete origin', () => {
  for (const [schema,args] of [[schemas.prices,{query:'produto'}],
    [schemas.basket,{retailer:'paguemenos',items:[{sku:'2'}]}],
    [schemas.baskets,{retailers:['drogasil'],items:[{gtin}]}]]) {
    const coordinates = {latitude:0,longitude:0};
    assert.ok(schema.safeParse({...args,coordinates}).success);
    for (const invalid of [{},{zipcode,coordinates},{coordinates:{latitude:0}},{coordinates:{latitude:0,longitude:181}}]) {
      assert.equal(schema.safeParse({...args,...invalid}).success,false);
    }
  }
});

test('an available basket without prices verified at the requested location stays out of the ranking', async () => {
  const coordinates = {latitude:0,longitude:-44};
  const offer = {gtin, sku:'2', sellerId:'1', name:'Exemplo 750 mg 20 comprimidos'};
  const paguemenos = {byGtin:async()=>[offer], product:async()=>[offer], basket:async()=>[
    {...offer, localStatus:'available', methods:[], priceScope:'anonymous_online', requestedQuantity:1, currentPrice:5}
  ]};
  const result = await compareBaskets({items:[{gtin,quantity:1}],retailers:['paguemenos'],coordinates},{paguemenos});
  assert.equal(result.results[0].status,'fulfillable');
  assert.equal(result.results[0].priceScope,'unconfirmed');
  assert.deepEqual(result.rankedProductSubtotals,[]);
});
