import { catalogSnapshot } from 'drogasil-cli/retailer-workflows';
export { catalogSnapshot };

function values(...fields) {
  return [...new Set(fields.flat().filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))];
}

export function catalogType(row) {
  const facts = row.facts ?? {};
  const labels = values(facts['Tipo de Medicamento'], facts.Generico, row.type);
  if (labels.some(v => /^gen[eé]ric[oa]s?$/iu.test(v)) || values(facts.Generico).some(v => /^sim$/iu.test(v))
      || /\bgen[eé]ric[oa]\b/iu.test(row.name)) return 'Genérico';
  if (labels.some(v=>/^refer[eê]ncia$/iu.test(v))) return 'Referência';
  if (labels.some(v=>/^similar(?:es)?$/iu.test(v))) return 'Similar';
  return row.type ?? 'Não informado';
}

// These are catalog labels. A missing regulatory field must remain unknown.
export function medicationCard(row) {
  const fields = row.facts ?? {};
  const title = row.name ?? '';
  const form = title.match(/\b(?:comprimidos?(?:\s+(?:sublingua(?:l|is)|revestidos?|efervescentes?|mastig[aá]veis))?|c[áa]psulas?|gotas|solu[çc][ãa]o oral|suspens[ãa]o oral|xarope|pomada|creme)\b/giu);
  const strengths = title.match(/\b\d+(?:[.,]\d+)?\s*(?:mcg|µg|mg|g|ui|%)(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:ml|g|h|dose|gota))?(?![\p{L}\d])/giu);
  const packs = title.replace(/\/\s*(?:\d+(?:[.,]\d+)?\s*)?ml\b/gi, '/').match(/\b\d+(?:[.,]\d+)?\s*(?:ml|comprimidos?|c[áa]psulas?|ampolas?|sach[eê]s?)\b/giu);
  const activeIngredients = values(row.activeIngredients, fields.NomeSubstanciaPrincipioAtivo, fields['Princípio Ativo']);
  const release = title.match(/\blibera[çc][ãa]o (?:imediata|prolongada|modificada|retardada|controlada)|\b(?:XR|SR|LP|CR)\b/gi);
  return { sku: row.sku, gtin: row.gtin ?? null, name: title, type: catalogType(row), source: row.productUrl ?? null,
    activeIngredients, ingredientEvidence: row.ingredientEvidence ?? (activeIngredients.length ? {source:'retailer_field'} : null),
    strengths: values(fields.Dosagem, strengths ?? []), forms: values(fields['Forma Farmacêutica'], form ?? []),
    routes: values(fields['Forma de Administração'], fields['Formas de Administração'], fields['Via de Administração']),
    release: values(fields['Tipo de Liberação'], release ?? []), packs: values(fields.Quantidade, packs ?? []),
    prescriptionLabel: values(fields['Prescrição Médica'], fields['Tipo de Receita']),
    retentionLabel: values(fields['Retenção de Receita']), observedAt: row.observedAt ?? null };
}

export async function catalogInfo({retailer, queries, page, limit}, source) {
  const results = [];
  for (const query of queries) {
    try {
      const bySku = /^\d+$/.test(query);
      const rows = source.facts ? await source.facts(query,page,limit)
        : bySku ? await source.product(query) : await source.search(query,page,limit);
      // Each seller of one SKU shares its catalog identity.
      const products = [...new Map(rows.map(row => [row.sku, medicationCard(row)])).values()];
      results.push({query, status: products.length ? 'matches' : bySku ? 'unknown_sku' : 'no_match', products});
    } catch { results.push({query, status:'source_failed', products:[]}); }
  }
  return {retailerId:retailer, scope:'retailer_catalog', page, limitPerQuery:limit, results};
}

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
