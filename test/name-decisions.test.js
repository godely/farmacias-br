import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {question, readAnswer, summarize} from '../scripts/name-resolution/decision.mjs';

const sample = {id: 'two', query: 'Q', candidates: ['A', 'B'], expected: 0, sources: ['https://example.com/private']};
test('both providers receive the same candidates without the answer key, source URLs or case metadata', () => {
  const openai = question('openai', 'test', sample, true);
  const jev = question('jev', 'test', sample, true);
  assert.equal(jev.expected, 'c2');
  assert.equal(openai.expected, jev.expected);
  assert.deepEqual(JSON.parse(openai.body.input), jev.body.state);
  assert.deepEqual(jev.body.state, {pedido: 'Q', candidatos: {c1: 'B', c2: 'A'}});
  for (const result of [openai, jev]) assert.doesNotMatch(JSON.stringify(result.body), /expected|example\.com|"two"/);
});

test('unusable decisions cannot count as successful identifications', () => {
  const options = question('jev', 'test', sample, false).options;
  const parse = identity => readAnswer('jev', {answers: {identity}}, options);
  assert.deepEqual(parse({type: 'refusal'}), {outcome: 'refusal'});
  assert.throws(() => parse({type: 'choice', choice: 'c3'}), /invalid_choice/);
  assert.throws(() => parse({type: 'choice', choice: 'c2', probabilities: {c2: 5}}), /invalid_probability/);
  const rows = [false, true].map(reverse => ({
    id: 'two', reverse, expected: reverse ? 'c2' : 'c1', choice: reverse ? 'c2' : 'c1',
    outcome: 'decision', inputTokens: 10, ms: reverse ? 200 : 100,
  }));
  const stable = summarize([sample], rows);
  assert.equal(stable.orderChanges, 0);
  assert.equal(stable.correctCases, 1);
  assert.equal(stable.medianMs, 150);
  assert.equal(stable.inputTokens, 20);
  rows[1].choice = 'c1';
  assert.equal(summarize([sample], rows).orderChanges, 1);
  assert.equal(summarize([sample], rows).wrongCandidate, 1);
  rows[1].outcome = 'error';
  assert.equal(summarize([sample], rows).correctCases, 0);
});

test('public catalog examples link each labeled candidate to its retailer', async () => {
  const cases = JSON.parse(await readFile(new URL('../scripts/name-resolution/catalog-cases.json', import.meta.url), 'utf8'));
  const hosts = {drogasil: 'www.drogasil.com.br', paguemenos: 'www.paguemenos.com.br', drogariasaopaulo: 'www.drogariasaopaulo.com.br'};
  assert.deepEqual(new Set(cases.map(item => item.retailer)), new Set(Object.keys(hosts)));
  for (const item of cases) {
    assert.equal(item.sources.length, item.candidates.length);
    for (const url of item.sources) assert.equal(new URL(url).hostname, hosts[item.retailer]);
    question('openai', 'test', item, true);
  }
});
