#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { request } from '../src/index.js';

const usage = `Farmácias BR
  farmacias retailers
  farmacias search <nome> [--retailer ID] [--page N] [--limit N]
  farmacias product <SKU> --retailer ID
  farmacias stock <SKU> --retailer ID (--cep CEP | --lat LAT --lon LON) [--quantity N]
  farmacias prices <nome, SKU ou GTIN> --cep CEP [--retailer ID] [--generics]
  Resultados em JSON. Os identificadores de loja estão em farmacias retailers.`;
try {
  const { positionals: [operation, ...terms], values } = parseArgs({ allowPositionals: true, options: {
    lat: { type: 'string' }, lon: { type: 'string' }, help: { type: 'boolean', short: 'h' }, retailer: { type: 'string' }, cep: { type: 'string' },
    page: { type: 'string' }, limit: { type: 'string' }, quantity: { type: 'string' },
    generics: { type: 'boolean' }, json: { type: 'boolean' },
  } });
  if (values.help || !operation) console.log(usage);
  else {
    const args = {};
    if (terms.length) args[['stock','product'].includes(operation) ? 'sku' : 'query'] = terms.join(' ');
    if (values.retailer !== undefined) args.retailer = values.retailer;
    if (values.lat !== undefined || values.lon !== undefined) {
      args.coordinates = { latitude: values.lat?.trim() ? Number(values.lat) : NaN,
        longitude: values.lon?.trim() ? Number(values.lon) : NaN };
    }
    if (values.cep !== undefined) args.zipcode = values.cep;
    if (values.generics !== undefined) args.includeGenerics = values.generics;
    for (const key of ['limit','page','quantity']) if (values[key] !== undefined) args[key] = Number(values[key]);
    console.log(JSON.stringify(await request(operation, args), null, 2));
  }
} catch (err) { console.error(err.message); process.exitCode = 1; }
