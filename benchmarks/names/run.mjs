import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {classify,orderedChoices} from './providers.mjs';

const out = process.argv[2];
if (!out) throw Error('Supply a new JSON output file.');
const raw = await readFile(new URL('cases.json',import.meta.url));
const cases = JSON.parse(raw);
const catalogBytes = await readFile(new URL('catalog.json',import.meta.url));
const catalog = JSON.parse(catalogBytes);
const catalogDigest = createHash('sha256').update(catalogBytes).digest('hex');
assert.equal(createHash('sha256').update(raw).digest('hex'),catalog.caseDigest);
assert.equal(cases.length,catalog.rows.length);
const providers = ['local','openai','jev'];
const rounds = 4;
const runs = [];
const fatal = new Map();
const started = new Date().toISOString();
for (const env of ['OPENAI_API_KEY','JEV_API_KEY']) if (!process.env[env]) throw Error('Missing '+env);
await writeFile(out,JSON.stringify({started,catalogDigest,caseDigest:catalog.caseDigest,rounds,runs}),{flag:'wx'});
for (let round=0;round<rounds;round++) {
  // Interleave both providers and keep one request per provider in flight.
  for (const [i,c] of cases.entries()) {
    const row = catalog.rows[i];
    assert.equal(row.id,i+1);
    const result = {id:row.id,round,local:{pick:row.local,ms:row.localMs[round]}};
    const options = orderedChoices(row.candidates,catalog.evidence,row.id,round);
    await Promise.all(providers.slice(1).map(async provider=>{
      if (!row.candidates.length) result[provider]={pick:null,skipped:true};
      else if (fatal.has(provider)) result[provider]={error:fatal.get(provider),skipped:true};
      else {
        const response = await classify(provider,c.query,options);
        if (/^http_(400|401|402|403|404)$/.test(response.error??'')) fatal.set(provider,response.error);
        result[provider]=response;
      }
    }));
    runs.push(result);
  }
  const temporary = out+'.'+process.pid+'.partial';
  await writeFile(temporary,JSON.stringify({started,catalogDigest,caseDigest:catalog.caseDigest,rounds,runs})+'\n',{flag:'wx'});
  await rename(temporary,out);
  console.error('Rodada '+(round+1)+'/'+rounds+' concluída.');
}
