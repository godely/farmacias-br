// Freeze live resolver inputs separately from inference so every provider gets the same catalog.
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readFile,writeFile} from 'node:fs/promises';
import {isDcbName,medicationIntent,nameChoices} from 'drogasil-cli/medication-catalog';
import {resolveMedication} from 'drogasil-cli';

const here = file => new URL(file, import.meta.url);
const raw = await readFile(here('cases.json'));
const cases = JSON.parse(raw);
const caseDigest = createHash('sha256').update(raw).digest('hex');
const fold = text => text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
const evidence = new Map();
async function document(name) {
  if (!evidence.has(name)) {
    const found = await resolveMedication(name);
    const intent = await medicationIntent(name);
    const sources = [];
    if (isDcbName(name)) sources.push('DCB');
    if (['ingredient','brand'].includes(found.kind) && !found.interpretation && !found.suffix)
      sources.push(found.kind === 'brand' ? 'marca no catálogo Drogasil' : 'princípio ativo no catálogo Drogasil');
    if (!sources.length) throw new Error('Candidato sem documentação: '+name);
    evidence.set(name,{kind:intent.kind,sources});
  }
}
const rows = [];
for (const [index,c] of cases.entries()) {
  const intent = await medicationIntent(c.query);
  const suffix = intent.suffix ? ' '+intent.suffix : '';
  const strip = text => suffix && text.endsWith(suffix) ? text.slice(0,-suffix.length) : text;
  const exact = ['ingredient','brand'].includes(intent.kind);
  const current = exact ? [intent.name] : intent.suggestions.slice(0,7).map(strip);
  const candidates = [...new Set((c.candidates ?? current).map(fold))];
  for (const name of candidates) await document(name);
  const timings = [];
  let picks;
  for (let i=0;i<4;i++) {
    const start = performance.now();
    const native = await medicationIntent(c.query);
    picks = ['ingredient','brand'].includes(native.kind) ? [native.name] : (await nameChoices(c.query,{intentFor:async()=>native})).map(strip);
    timings.push(Number((performance.now()-start).toFixed(3)));
  }
  const local = picks.length===1 && candidates.includes(fold(picks[0])) ? fold(picks[0]) : null;
  rows.push({id:index+1,candidates,local,native:picks,localMs:timings});
}
await writeFile(here('catalog.json'),JSON.stringify({caseDigest,capturedAt:new Date().toISOString(),evidence:Object.fromEntries(evidence),rows},null,2)+'\n');
console.log(rows.length+' consultas, '+evidence.size+' nomes documentados.');
