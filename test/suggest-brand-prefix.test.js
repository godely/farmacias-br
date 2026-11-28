import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from '../src/index.js';
import {toolReply} from '../src/server.js';

test('direct suggestions keep brand and ingredient choices even with a one-result limit', async t => {
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    const {requests} = JSON.parse(init.body);
    assert.ok(requests[0].facets, 'only the medication name index should be needed');
    return Response.json({results:[{facets:{
      'filters.Marca':{Dexador:2, Dexason:1},
      'details.activeIngredients.description':{Dexametasona:3},
    }}]});
  });
  const args = {retailer:'drogasil', query:'dexa 4 mg', limit:1};
  const reply = toolReply('suggest', args, await request('suggest', args)).structuredContent;
  assert.equal(reply.interaction, 'awaiting_name_choice');
  assert.deepEqual(reply.nameChoice.options.map(o => o.term), ['dexametasona 4 mg','dexador 4 mg','dexason 4 mg']);
  assert.deepEqual(reply.nameChoice.options[1].onSelect, {...args,query:'dexador 4 mg'});
  const raw = await request('suggest', {...args, listAll:true});
  assert.equal(raw.nameChoice, undefined);
  assert.deepEqual(raw.suggestions, ['dexametasona 4 mg']);
});
