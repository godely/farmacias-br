// Run against the live catalog through a separate stdio MCP. Synthetic misses
// should not enter the hosted service's Sentry counts.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cases = {
  prefix: [
    ['morfi','morfina'], ['paracet','paracetamol'], ['ibupro','ibuprofeno'], ['lorata','loratadina'],
    ['dipiro','dipirona'], ['amoxic','amoxicilina'], ['omepraz','omeprazol'], ['cetocon','cetoconazol'],
  ],
  swap: [
    ['mrofina','morfina'], ['paracetmaol','paracetamol'], ['dipirnoa','dipirona'],
    ['ibuporfeno','ibuprofeno'], ['loartadina','loratadina'], ['tylneol','tylenol'],
    ['rivtoril','rivotril'], ['morfian','morfina'], ['omeprazlo','omeprazol'],
    ['metfromina','metformina'], ['prednisoan','prednisona'],
  ],
  misspelling: [
    ['amoxcilina','amoxicilina'], ['parassettamol','paracetamol'], ['ibuprofennu','ibuprofeno'],
    ['omeprazoll','omeprazol'], ['lohratadinna','loratadina'], ['dippironna','dipirona'],
    ['clonazepann','clonazepam'], ['azitromissina','azitromicina'],
  ],
  alias: [['acetaminophen','paracetamol'],['metamizole','dipirona'],['morphine','morfina']],
  invented: [['zzxqvbrt'], ['qqzkvanto'], ['vxzqmbrr'], ['nzpqvxol'], ['xxqzkrpina'], ['qjvtxzpm']],
  exact: [['morfina','morfina'], ['paracetamol','paracetamol'], ['loratadina','loratadina'], ['ibuprofeno','ibuprofeno']],
};
const client = new Client({name:'paguemenos-spelling-check',version:'1'});
const call = async (name, args) => {
  const result = await client.callTool({name, arguments:args});
  assert.ok(!result.isError, name+' failed');
  return result.structuredContent;
};
const norm = s => s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const counts = {};
try {
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('../bin/server.js',import.meta.url))], env:{FARMACIAS_SENTRY_DSN:''}}));
  for (const [kind, inputs] of Object.entries(cases)) {
    for (const [query, expected] of inputs) {
      try {
        const args = {query, retailer:'paguemenos', limit:1};
        const [group] = (await call('pharmacy_search',args)).results;
        let outcome;
        if (kind === 'exact') {
          assert.ok(group.products.length && !group.confirmation);
          outcome = 'exact';
        } else if (group.confirmation) {
          assert.ok(expected, 'invented name produced a correction');
          const [term] = group.suggestions;
          assert.equal(norm(term), expected);
          assert.equal(group.suggestions.length, 1);
          assert.equal(group.confirmation.question, 'Você quis dizer '+term+'?');
          assert.deepEqual(group.products, []);
          const no = await call('pharmacy_suggest',group.confirmation.onNo);
          assert.ok(['suggestions','no_suggestions'].includes(no.status));
          assert.ok(no.suggestions.every(other => norm(other) !== norm(term)));
          const yes = (await call('pharmacy_search',{...group.confirmation.onYes, limit:query==='morfi'?50:1})).results[0];
          assert.equal(yes.status, 'matches', 'accepted term has no catalog matches');
          if (query === 'morfi') {
            assert.deepEqual(yes.products.map(p=>p.sku).sort(), ['6974','6981','7191']);
            assert.ok(yes.products.every(p=>p.activeIngredients.some(a=>norm(a)==='morfina')));
          }
          outcome = 'confirmed';
        } else {
          assert.equal(group.status, 'no_match');
          assert.equal(group.suggestionStatus, 'no_suggestions');
          assert.deepEqual(group.products, []);
          assert.ok(!expected, 'expected a correction but none was returned');
          outcome = 'no_match';
        }
        console.log(kind, query, outcome, group.confirmation?.question ?? '');
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      } catch (error) {
        console.error(kind, query, 'FAILED', error.message);
        counts.failed = (counts.failed ?? 0) + 1;
        process.exitCode = 1;
      }
    }
  }
  console.log(JSON.stringify(counts));
} finally { await client.close(); }
