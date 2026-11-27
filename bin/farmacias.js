#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { request } from '../src/index.js';

const usage = `Farmácias BR
  farmacias retailers
  farmacias search <nome> [--retailer ID] [--page N] [--limit N]
  farmacias suggest <prefixo> [--retailer ID] [--limit N]
  farmacias product <SKU> --retailer ID
  farmacias product --gtin EAN --retailer ID
  farmacias product <SKU> <SKU> --retailer ID
  farmacias stores --retailer ID [--page N --limit N]
  farmacias compare <nome ou SKU> --retailer ID [--generics]
  farmacias basket SKU[:quantidade[:vendedor]]... --retailer ID --cep CEP
  farmacias info <nome ou SKU>... --retailer ID
  farmacias snapshot <consulta>... --retailer ID [--max-items N]
  farmacias read_snapshot <run-id> [--offset N --limit N]
  farmacias stock <SKU> --retailer ID (--cep CEP | --lat LAT --lon LON) [--quantity N]
  farmacias prices <nome, SKU ou GTIN> --cep CEP [--retailer ID] [--generics]
  Resultados em JSON. Os identificadores de loja estão em farmacias retailers.`;
try {
  const { positionals: [operation, ...terms], values } = parseArgs({ allowPositionals: true, options: {
    lat: { type: 'string' }, lon: { type: 'string' }, help: { type: 'boolean', short: 'h' }, retailer: { type: 'string' }, cep: { type: 'string' },
    gtin: {type:'string'}, 'max-items':{type:'string'}, offset:{type:'string'},
    page: { type: 'string' }, limit: { type: 'string' }, quantity: { type: 'string' },
    generics: { type: 'boolean' }, json: { type: 'boolean' },
  } });
  if (values.help || !operation) console.log(usage);
  else {
    const args = {};
    if (values.gtin !== undefined) args.gtin=values.gtin;
    if (values['max-items'] !== undefined) args.maxItems=Number(values['max-items']);
    if (values.offset !== undefined) args.offset=Number(values.offset);
    if (operation === 'basket') args.items=terms.map(term=>{
      if (!/^\d+(?::\d+(?::[^:]+)?)?$/.test(term)) throw Error('Expected SKU[:quantity[:seller]]');
      const [sku,quantity,sellerId]=term.split(':');
      return {sku,quantity:Number(quantity??1),sellerId};
    });
    else if (operation === 'read_snapshot') args.runId=terms.join(' ');
    else if (['info','snapshot'].includes(operation)) args.queries=terms;
    else if (operation === 'product' && terms.length>1) args.skus=terms;
    else if (terms.length) args[['stock','product'].includes(operation) ? 'sku' : 'query'] = terms.join(' ');
    if (values.retailer !== undefined) args.retailer = values.retailer;
    if (values.lat !== undefined || values.lon !== undefined) {
      args.coordinates = { latitude: values.lat?.trim() ? Number(values.lat) : NaN,
        longitude: values.lon?.trim() ? Number(values.lon) : NaN };
    }
    if (values.cep !== undefined) args.zipcode = values.cep;
    if (operation === 'compare') args.includeGenerics=values.generics??false;
    if (values.generics !== undefined) args.includeGenerics = values.generics;
    for (const key of ['limit','page','quantity']) if (values[key] !== undefined) args[key] = Number(values[key]);
    console.log(JSON.stringify(await request(operation, args), null, 2));
  }
} catch (err) { console.error(err.message); process.exitCode = 1; }
