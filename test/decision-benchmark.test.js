import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {orderedChoices} from '../benchmarks/names/providers.mjs';

test('choice order varies within pairs while every decision stays inside its documented shortlist',()=>{
  const names=['prednisona','prednisolona'];
  const evidence=Object.fromEntries(names.map(name=>[name,{sources:['DCB']}]));
  const choices=round=>orderedChoices(names,evidence,1,round);
  assert.deepEqual(choices(0),choices(2));
  assert.deepEqual(choices(1),choices(3));
  assert.notDeepEqual(choices(0),choices(1));
  for (const round of [0,1]) {
    const rows=choices(round);
    assert.deepEqual(new Set(rows.map(r=>r.name)),new Set([null,...names]));
    assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
  }
});

test('the published measurement reproduces the denominators and distinguishes wrong choices from abstentions',()=>{
  const file=name=>fileURLToPath(new URL('../benchmarks/names/'+name,import.meta.url));
  const summary=JSON.parse(execFileSync(process.execPath,[file('report.mjs'),file('2026-11-28.json.gz')]));
  assert.equal(summary.scenarios,66);
  for (const p of Object.values(summary.providers))
    assert.equal(p.rightName+p.wrongName+p.missedAvailableName+p.rightClarification+p.errors,264);
  assert.equal(summary.providers.openai.attempts,236);
  assert.equal(summary.providers.jev.attempts,236);
  assert.equal(summary.providers.jev.categories.missing.wrongName,4);
  assert.equal(summary.providers.openai.categories.missing.wrongName,2);
  assert.equal(summary.providers.jev.categories.severe_fixed.missedAvailableName,0);
  assert.equal(summary.providers.jev.estimatedUSD,0.004554);
  assert.equal(summary.providers.openai.estimatedUSD,0.005454);
});
