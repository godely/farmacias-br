import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const names = ['local','openai','jev'];
const raw = await readFile(new URL('cases.json',import.meta.url));
const cases = JSON.parse(raw);
const catalogBytes = await readFile(new URL('catalog.json',import.meta.url));
const catalog = JSON.parse(catalogBytes);
const catalogDigest = createHash('sha256').update(catalogBytes).digest('hex');
const file = await readFile(process.argv[2]);
const batch = JSON.parse(process.argv[2].endsWith('.gz') ? gunzipSync(file) : file);
assert.equal(createHash('sha256').update(raw).digest('hex'),batch.caseDigest);
assert.equal(batch.caseDigest,catalog.caseDigest);
assert.equal(batch.catalogDigest,catalogDigest,'Catalog differs from the frozen benchmark input');
assert.equal(batch.runs.length,batch.rounds*cases.length);
assert.equal(new Set(batch.runs.map(r=>r.id+'-'+r.round)).size,batch.runs.length);
const round = n => Math.round(n*1e6)/1e6;
function quantile(values,p) {
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted.length ? round(sorted[Math.ceil(sorted.length*p)-1]) : null;
}
const count = () => ({rightName:0,rightClarification:0,wrongName:0,missedAvailableName:0,errors:0});
const groups = {};
for (const provider of names) {
  const totals = count(), categories = {}, models = new Set(), byCase = new Map(), times = [];
  let inputs=0,outputs=0,attempts=0,unmetered=0,cacheTokens=0;
  for (const {id,round:index,[provider]:answer} of batch.runs) {
    const c = cases[id-1], row = catalog.rows[id-1];
    const expected = c.identity && row.candidates.includes(c.identity) ? c.identity : null;
    const value = answer.pick;
    if (!answer.error) assert.ok(value===null || row.candidates.includes(value));
    const grade = answer.error ? 'errors' : value===null ? expected ? 'missedAvailableName' : 'rightClarification' :
      value===expected ? 'rightName' : 'wrongName';
    totals[grade]++;
    (categories[c.category] ??= count())[grade]++;
    if (!byCase.has(id)) byCase.set(id,[]);
    byCase.get(id)[index] = {grade,value,error:answer.error};
    if (answer.model) models.add(answer.model);
    if (!answer.skipped && provider!=='local') {
      attempts++;
      const u=answer.usage;
      if (Number.isSafeInteger(u?.input_tokens) && Number.isSafeInteger(u?.output_tokens)) {
        inputs+=u.input_tokens; outputs+=u.output_tokens;
        cacheTokens+=(u.input_tokens_details?.cached_tokens??0)+(u.input_tokens_details?.cache_write_tokens??0);
      } else unmetered++;
    }
    if (Number.isFinite(answer.ms) && !answer.error) times.push(answer.ms);
  }
  // All measured requests use short inputs. Omit a cost estimate if special cache
  // rates or unmetered attempts require a billing reconciliation.
  const dollars = (provider==='openai' ? 0.10 : 0.042)*inputs/1e6;
  const costsKnown = !cacheTokens && !unmetered;
  const wrong=[], unstable=[], positionSensitive=[], missingIds=[];
  for (const [id,entries] of byCase) {
    if (entries.some(e=>e.grade==='wrongName')) wrong.push(id);
    if (entries.some(e=>e.grade==='missedAvailableName')) missingIds.push(id);
    if (entries.some(e=>e.error)) continue;
    if (entries[0].value!==entries[2].value || entries[1].value!==entries[3].value) unstable.push(id);
    if (entries[0].value!==entries[1].value || entries[2].value!==entries[3].value) positionSensitive.push(id);
  }
  groups[provider]={models:[...models],...totals,categories,wrongCaseIds:wrong,missedCaseIds:missingIds,
    sameOrderChanged:unstable,crossOrderChanged:positionSensitive,p50Ms:quantile(times,.5),p95Ms:quantile(times,.95),attempts,
    inputTokens:inputs,outputTokens:outputs,unmetered,cacheTokens,estimatedUSD:costsKnown ? round(dollars) : null,
    usdPer1000Calls:attempts && costsKnown ? round(1000*dollars/attempts) : null,
    usdPer1000Scenarios:costsKnown ? round(1000*dollars/batch.runs.length) : null};
}
const liveCases = cases.map((c,i)=>({c,...catalog.rows[i]})).filter(r=>!r.c.candidates && r.c.identity);
const missingFromRetrieval = liveCases.filter(r=>!r.candidates.includes(r.c.identity)).map(r=>r.id);
console.log(JSON.stringify({started:batch.started,caseDigest:batch.caseDigest,scenarios:cases.length,distinctQueries:new Set(cases.map(c=>c.query)).size,
  rounds:batch.rounds,expectedLiveIdentities:liveCases.length,missingFromRetrieval,providers:groups},null,2));
