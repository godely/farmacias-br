#!/usr/bin/env node
import { parseArgs } from 'node:util';
import {coordinateArgs, planArgs, planUsage} from './plan-args.js';
import { request } from '../src/index.js';
import { runSnapshotCommand } from 'drogasil-cli/retailer-workflows';

const usage = `Farmácias BR
  farmacias retailers
  ${planUsage}
  farmacias search <nome> [--retailer ID ...] [--page N] [--limit N]
  farmacias suggest <prefixo> [--retailer ID] [--limit N]
  farmacias product <SKU> --retailer ID
  farmacias product --gtin EAN --retailer ID
  farmacias product <SKU> <SKU> --retailer ID
  farmacias stores (--retailer ID | --retailers ID,ID) [--cep CEP | --lat LAT --lon LON] [--page N --limit N]
  farmacias compare <nome ou SKU> --retailer ID [--generics] [--cep CEP | --lat LAT --lon LON] [--store nearest|ID | --expand]
  farmacias baskets GTIN[:quantidade]... --retailers ID,ID (--cep CEP | --lat LAT --lon LON)
  farmacias basket SKU[:quantidade[:vendedor]]... --retailer ID (--cep CEP | --lat LAT --lon LON)
  farmacias info <nome>... (--retailer ID | --retailers ID,ID) [--brazil] [--page N --limit N]
  farmacias snapshot <consulta>... (--retailer ID | --retailers ID,ID) [--max-items N]
  farmacias read_snapshot <run-id> [--offset N --limit N]
  farmacias export_snapshot <run-id> [--format json|csv|xlsx]
  farmacias stock <SKU> --retailer ID (--cep CEP | --lat LAT --lon LON) [--quantity N | --all] [--max-branches N] [--expand]
  farmacias prices <nome, SKU ou GTIN> (--cep CEP | --lat LAT --lon LON) [--retailer ID_DO_SKU] [--retailers ID,ID] [--generics]
  Resultados em JSON. Os identificadores de loja estão em farmacias retailers.`;
try {
  if (process.argv[2] === 'plan') {
    const terms = process.argv.slice(3);
    if (terms.includes('--help') || terms.includes('-h')) console.log(planUsage);
    else console.log(JSON.stringify(await request('plan', planArgs(terms)), null, 2));
  } else await runOther();
} catch (err) { console.error(err.message); process.exitCode = 1; }

async function runOther() {
  const { positionals: [operation, ...terms], values } = parseArgs({ args:coordinateArgs(process.argv.slice(2)), allowPositionals: true, options: {
    lat: { type: 'string' }, lon: { type: 'string' }, help: { type: 'boolean', short: 'h' }, retailer: { type: 'string', multiple:true }, retailers:{type:'string'}, brazil:{type:'boolean'}, cep: { type: 'string' },
    expand:{type:'boolean'}, all:{type:'boolean'}, 'max-branches':{type:'string'}, store:{type:'string'}, gtin: {type:'string'}, 'max-items':{type:'string'}, offset:{type:'string'}, format:{type:'string'},
    page: { type: 'string' }, limit: { type: 'string' }, quantity: { type: 'string' },
    generics: { type: 'boolean' }, json: { type: 'boolean' },
  } });
  if (values.help || !operation) console.log(usage);
  else if (operation === 'export_snapshot') {
    if (Object.keys(values).some(key => key !== 'format')) throw Error('O export aceita apenas --format');
    process.exitCode = await runSnapshotCommand(['export', ...terms], values);
  }
  else {
    if (values.format !== undefined) throw Error('--format é válido apenas para export_snapshot');
    const args = {};
    if (values.store !== undefined) args.store=values.store;
    if (values.gtin !== undefined) args.gtin=values.gtin;
    if (values['max-items'] !== undefined) args.maxItems=Number(values['max-items']);
    if (values.offset !== undefined) args.offset=Number(values.offset);
    if(operation==='baskets') args.items=terms.map(term=>{
      if(!/^\d+(?::\d+)?$/.test(term)) throw Error('Expected GTIN[:quantity]');
      const [gtin,quantity]=term.split(':');
      return {gtin,quantity:Number(quantity??1)};
    });
    else if (operation === 'basket') args.items=terms.map(term=>{
      if (!/^\d+(?::\d+(?::[^:]+)?)?$/.test(term)) throw Error('Expected SKU[:quantity[:seller]]');
      const [sku,quantity,sellerId]=term.split(':');
      return {sku,quantity:Number(quantity??1),sellerId};
    });
    else if (operation === 'read_snapshot') args.runId=terms.join(' ');
    else if (['info','snapshot'].includes(operation)) args.queries=terms;
    else if (operation === 'product' && terms.length>1) args.skus=terms;
    else if (terms.length) args[['stock','product'].includes(operation) ? 'sku' : 'query'] = terms.join(' ');
    if (values.retailer?.length===1) args.retailer=values.retailer[0];
    else if (values.retailer?.length && ['search','info','stores'].includes(operation) && !values.retailers) args.retailers=values.retailer;
    else if(values.retailer?.length) throw Error('Use --retailers for multiple target chains');
    if (values.retailers!==undefined) args.retailers=values.retailers.split(',').map(s=>s.trim());
    if (values.brazil) args.scope='brazil';
    if (values.lat !== undefined || values.lon !== undefined) {
      args.coordinates = { latitude: values.lat?.trim() ? Number(values.lat) : NaN,
        longitude: values.lon?.trim() ? Number(values.lon) : NaN };
    }
    if (values.expand) args.expandSearch = true;
    if (values.all) args.includeAll = true;
    if (values['max-branches'] !== undefined) args.maxBranches = Number(values['max-branches']);
    if (values.cep !== undefined) args.zipcode = values.cep;
    if (operation === 'compare') args.includeGenerics=values.generics??false;
    if (values.generics !== undefined) args.includeGenerics = values.generics;
    for (const key of ['limit','page','quantity']) if (values[key] !== undefined) args[key] = Number(values[key]);
    console.log(JSON.stringify(await request(operation, args), null, 2));
  }
}
