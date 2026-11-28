// Run from an installation of the tested packages. The two CEPs are inputs,
// used only to exercise the planner's confirmation before it can query stock.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const run = promisify(execFile);
const origins = process.argv.slice(2);
assert.ok(origins.length === 2 && origins.every(s => /^\d{5}-?\d{3}$/.test(s)), 'Supply two test CEPs');
for (const [i, retailer] of ['drogasil','paguemenos','drogariasaopaulo'].entries()) {
  const entry = import.meta.resolve(retailer + '-cli');
  const cli = fileURLToPath(new URL(retailer === 'drogasil' ? '../../bin/drogasil.js' : 'cli.js', entry));
  async function invoke(args, expected = 0) {
    let result;
    try { result = await run(process.execPath,[cli,...args,'--json'], {timeout:120000}); }
    catch (error) { result = error; }
    assert.equal(result.code ?? 0, expected, retailer + ' ' + args[0] + ': ' + result.stderr);
    return {data:JSON.parse(result.stdout), message:result.stderr.trim()};
  }
  const ambiguous = await invoke(['search','dexa 4 mg'], 3);
  assert.ok(ambiguous.message.includes('dexador 4 mg') && ambiguous.message.includes('dexametasona 4 mg'));
  const expected = 'Você quis dizer prednisona ou prednisolona?';
  for (const args of [
    ['search','predniso'], ['compare','predniso'], ['info','Rivotril','predniso'],
    ['plan','Rivotril','predniso','--brand-only','A','--quantity','B=2','--cep',origins[i % 2]],
  ]) {
    const {data, message} = await invoke(args, 3);
    assert.equal(message, expected);
    if (args[0] === 'plan') {
      assert.deepEqual(data.tables, []);
      assert.equal(data.items[1].quantity,2);
      assert.equal(data.items[0].includeGenerics,false);
    }
  }
  assert.equal((await invoke(['search','morfi'],3)).message,'Você quis dizer morfina?');
  for (const name of ['prednisona','prednisolona','morfina']) {
    const {data} = await invoke(['search',name,'--limit','4']);
    const rows = data.hits ?? data;
    assert.ok(rows.length,retailer + ': ' + name);
    for (const row of rows) assert.ok(row.activeIngredients?.some(a =>
      a.toLowerCase().split(/[^\p{L}]+/u).includes(name)), retailer + ': ' + row.name);
  }
  console.log(retailer + ': 9 checks passed');
}
