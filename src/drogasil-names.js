import {medicationSearch} from 'drogasil-cli';
import {medicationCatalog, medicationIntent, verifiedRow} from 'drogasil-cli/medication-catalog';

const words = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu,'')
  .toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';

// Use the retailer's ingredient field for a confirmed ingredient. Keep literal
// non-medication searches working even if a nearby drug name is in the dictionary.
export function withDrogasilNames(source, catalogRow, intentFor=medicationIntent, search=medicationSearch) {
  async function searchVerified(intent,page,limit) {
    const query=[intent.name,intent.suffix].filter(Boolean).join(' ');
    if(intent.kind!=='ingredient') return source.search(query,page,limit);
    const options={page:page-1,hitsPerPage:limit};
    const result=await search(query,options);
    return result.hits.flatMap(hit=>{
      const details=hit.details ?? {};
      const ingredients=[details.activeIngredientDescriptionList,details.activeIngredients?.map(a=>a.description),
        details.principio_ativo_novo].flat().filter(s=>typeof s==='string' && s.trim());
      const row=verifiedRow(catalogRow(hit),intent,{ingredients:[...new Set(ingredients)],
        evidence:{source:'retailer_field',field:'details.activeIngredients'}});
      return row ? [row] : [];
    });
  }
  const adapter=medicationCatalog(source,{intentFor,searchVerified});
  return {...adapter,async search(query,page=1,limit=20) {
    if(/^\d+$/.test(query.trim())) return source.search(query,page,limit);
    const intent=await intentFor(query);
    if(!intent.suggestions.length) return searchVerified(intent,page,limit);
    const phrase=' '+words(query)+' ';
    const hits=await source.search(query,page,limit);
    return hits.filter(row=>(' '+words(row.name)+' ').includes(phrase) || words(row.brand)===words(query));
  }};
}
