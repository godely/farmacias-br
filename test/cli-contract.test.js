import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';

const modules = fileURLToPath(new URL('../node_modules/', import.meta.url));
const reference = process.env.FARMACIAS_REFERENCE_ROOT ?? join(modules,'drogasil-cli');
const partners = ['paguemenos','drogariasaopaulo'];
function executable(root, name) {
  const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  return resolve(root,pkg.bin[name]);
}
function invoke(bin, args, expected = 0) {
  const result = spawnSync(process.execPath,[bin,...args],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,expected,[bin,...args,result.stderr].join(' '));
  return expected === 0 ? result.stdout : (result.stderr || result.stdout);
}
function commands(help,name) {
  return [...help.matchAll(new RegExp('^\\s*'+name+' ([a-z][\\w-]*)','gm'))].map(match=>match[1]);
}
function actions(usage,command) {
  const syntax = usage.trim().split('\n\n')[0];
  const start = syntax.slice(syntax.indexOf(command+' ')+command.length+1);
  return [...start.matchAll(/(?:^|\s\|\s)([a-z][a-z_-]*)\s+(?=[<[])/g)].map(match=>match[1]);
}
const referenceBin = executable(reference,'drogasil');
const commandNames = commands(invoke(referenceBin,['--help']),'drogasil');
assert.ok(commandNames.includes('snapshot') && commandNames.includes('stock'));

for (const retailer of partners) {
  test(retailer+' public CLI follows the Drogasil command contract', async () => {
    const bin = executable(join(modules,retailer+'-cli'),retailer);
    const listed = commands(invoke(bin,['--help']),retailer);
    assert.equal(invoke(bin,['-h']),invoke(bin,['help']));
    invoke(bin,[],1);
    invoke(bin,['absent-command'],1);
    for (const command of commandNames) {
      assert.ok(listed.includes(command),retailer+' lacks '+command);
      const referenceHelp = invoke(referenceBin,[command,'--help']);
      const help = invoke(bin,[command,'--help']);
      const referenceModule = await import(pathToFileURL(join(dirname(referenceBin),'../src/commands',command+'.js')));
      const options = {json:{type:'boolean'},...referenceModule.options};
      const optionNames = Object.keys(options).map(key=>'--'+key);
      const advertised = new Set(help.match(/--[a-z][a-z-]*/g));
      const missing = optionNames.filter(option=>!advertised.has(option)).sort();
      assert.deepEqual(missing,[],retailer+' '+command+' option gaps changed');
      assert.deepEqual(actions(help,command),actions(referenceHelp,command),retailer+' '+command+' subcommands');
      // Parse every advertised option. The final invalid option stops execution
      // before a catalog, stock or snapshot operation can reach the network.
      const args = Object.entries(options).filter(([name])=>advertised.has('--'+name))
        .flatMap(([name,option])=>option.type === 'boolean' ? ['--'+name] : ['--'+name,'sample']);
      assert.match(invoke(bin,[command,...args,'--farmacias-unknown-option'],1),
        /unknown option ['"]--farmacias-unknown-option['"]/i);
    }
  });
}
