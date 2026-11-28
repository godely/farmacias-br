import {test} from 'node:test';
import assert from 'node:assert/strict';
import {medicationInfo, schemas} from '../src/index.js';
import {observations} from '../src/monitoring.js';

const ids = ['drogasil','paguemenos','drogariasaopaulo'];
const queries = ['Primeira marca','Segunda marca'];
function sourcesFor(calls, failing = () => false) {
  function products(id, term) {
    calls.push([id, term]);
    if (failing(id, term)) throw Error('lookup failed');
    return [1,2,3].map(n => ({sku:String(n), name:term+' '+n, productUrl:'https://example.com/'+n}));
  }
  return Object.fromEntries(ids.map(id => [id, id === 'drogasil' ? {
    info:async ([term], {scope}) => ({results:[{query:term,status:'matches',products:products(id, term),
      ...(scope === 'brazil' && {brazil:{presentations:[]}})}]}),
  } : {
    facts:async (term,page,limit) => products(id,term).slice((page-1)*limit,page*limit),
  }]));
}

test('the seven factual selections contact only their selected catalogs and page each query separately', async () => {
  for (let mask = 1; mask < 8; mask++) {
    const retailers = ids.filter((id, i) => mask & (1 << i)).reverse();
    const calls = [];
    const result = await medicationInfo({retailers,queries,page:2,limit:1}, sourcesFor(calls));
    assert.equal(result.status, 'checked');
    assert.deepEqual(result.results.map(group => group.retailerId), retailers);
    assert.deepEqual(calls.sort(), retailers.flatMap(id => queries.map(term => [id,term])).sort());
    for (const group of result.results) {
      assert.deepEqual(group.results.map(row => row.query), queries);
      assert.deepEqual(group.results.map(row => row.products.map(p => p.sku)), [['2'],['2']]);
    }
  }
});

test('one failed drug or retailer retains the other cards and anonymous failure observations', async () => {
  const failure = (id, term) => id === 'paguemenos' || (id === 'drogasil' && term === queries[1]);
  const args = {retailers:ids, queries};
  const result = await medicationInfo(args,sourcesFor([],failure));
  assert.equal(result.status,'partial');
  assert.deepEqual(result.results.map(group => group.status),['partial','source_failed','checked']);
  const records = observations('pharmacy_info',args,result);
  assert.equal(records.length,6);
  assert.deepEqual(records.map(row => row.outcome),['ok','upstream_failure','upstream_failure','upstream_failure','ok','ok']);
  assert.ok(queries.every(term => !JSON.stringify(records).includes(term)));
  const allFailed = await medicationInfo(args,sourcesFor([],() => true));
  assert.equal(allFailed.status,'source_failed');
});

test('a retailer-specific identifier is never sent to multiple catalogs', async () => {
  const calls = [];
  const sources = sourcesFor(calls);
  const refusal = await medicationInfo({retailers:ids, queries:['42']},sources);
  assert.equal(refusal.status,'requires_retailer');
  assert.deepEqual(calls,[]);
  for (const selector of [{retailer:'paguemenos'}, {retailers:['paguemenos']}]) {
    await medicationInfo({...selector, queries:['42']},sources);
  }
  assert.deepEqual(calls,[['paguemenos','42'],['paguemenos','42']]);
  for (const scope of [{}, {retailer:ids[0], retailers:ids}, {retailers:[ids[0],ids[0]]}]) {
    assert.equal(schemas.info.safeParse({...scope,queries}).success,false);
  }
});

test('national corroboration runs once per name in a request while each retailer supplies its own cards', async () => {
  const calls = [];
  const result = await medicationInfo({retailers:ids, queries, scope:'brazil'},sourcesFor(calls));
  assert.equal(result.status,'checked');
  assert.deepEqual(calls.filter(([id]) => id === 'drogasil').map(([,q]) => q),queries);
  for (const group of result.results) {
    assert.ok(group.results.every(row => row.products.length && row.brazil));
  }
});

test('an empty local catalog remains a completed check even if another returns products', async () => {
  const sources = sourcesFor([]);
  sources.paguemenos.facts = async () => [];
  const result = await medicationInfo({retailers:ids,queries},sources);
  assert.equal(result.status,'checked');
  assert.deepEqual(result.results[1].results.map(row => row.status),['no_match','no_match']);
});
