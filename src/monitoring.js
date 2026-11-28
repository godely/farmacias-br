import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createTransport, getEnvelopeEndpointWithUrlEncodedAuth, makeDsn } from '@sentry/core';

const release = 'farmacias-br@' + createRequire(import.meta.url)('../package.json').version;
const chains = new Map([
  ['Drogasil', 'drogasil'], ['Pague Menos', 'paguemenos'],
  ['Drogaria São Paulo', 'drogariasaopaulo'],
]);
const operations = new Set(['retailers', 'search', 'suggest', 'product', 'info', 'stores', 'compare', 'basket', 'baskets', 'snapshot', 'read_snapshot', 'stock', 'prices', 'get_medication_info',
  'plan_purchase', 'search_products', 'get_products', 'find_nearby_stock', 'compare_products',
  'compare_pharmacy_prices', 'collect_catalog_snapshot', 'read_catalog_snapshot', 'service', 'presentation_canary']);
const failures = new Set(['upstream_failure', 'lookup_miss', 'stock_unknown', 'catalog_incomplete', 'service_exit', 'handler_exception', 'timeout', 'canary_mismatch']);
const knownMiss = new Set(['no_reference', 'unknown_sku', 'unknown_gtin', 'no_match', 'no_exact_match']);
const sourceProblems = new Set(['failed', 'source_failed', 'catalog_lookup_failed', 'location_lookup_failed',
  'generic_lookup_failed', 'reference_lookup_failed', 'lookup_failed']);
const incomplete = new Set(['incomplete_presentation', 'no_prices', 'unconfirmed_gtin', 'missing_gtin', 'presentation_unconfirmed', 'quantity_unverified']);
const clarifications = new Set(['ambiguous', 'choose_reference', 'presentation_options', 'conflicting_release',
  'needs_generic_preference', 'needs_name_confirmation', 'requires_cep']);
const uuid = () => randomUUID().replaceAll('-', '');

function retailerId(value) {
  return chains.get(value) ?? ([...chains.values()].includes(value) ? value : 'all');
}

function queryShape(query) {
  if (typeof query !== 'string' || !query.trim()) return 'unspecified';
  if (/^\d+$/.test(query.trim())) return 'identifier';
  const text = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const flags = ['name'];
  if (/\d\s*(mg|mcg|ui|g)\b/.test(text)) flags.push('strength');
  if (/\b(comprimidos?|capsulas?|gotas?|solucao|tablets?|drops)\b/.test(text)) flags.push('form');
  if (/\b(liberacao|release|xr|sr|lp|retard)\b/.test(text)) flags.push('release');
  if (/\d\s*(?:ml|comprimidos?|capsulas?|tablets?)\b|\b(frasco|caixa)\b/.test(text)) flags.push('pack');
  return flags.join('.');
}

function outcome(row = {}) {
  const status = row.status ?? row.state ?? row.localStatus;
  if (row.suggestionStatus === 'source_failed') return 'upstream_failure';
  if (row.suggestionStatus === 'suggestions') return 'clarification';
  if (sourceProblems.has(status) || row.failed?.length || row.isError) return 'upstream_failure';
  if (knownMiss.has(status) || row.unknownSku === true) return 'lookup_miss';
  if (row.scope === 'nearest' && row.nearestStore) {
    const quantity = row.nearestStore.quantity;
    if (quantity == null) return 'stock_unknown';
    if (quantity === 0) return 'zero_stock';
    if (quantity < (row.minimumQuantity ?? 1)) return 'insufficient_stock';
  }
  if (row.expandedSearch?.partial || row.unknown?.length || status === 'stock_unknown' || row.coverage?.stockUnknown) return 'stock_unknown';
  if (['unverified','unknown'].includes(status)) return 'stock_unknown';
  if (row.coverage?.allZero || status === 'no_stock' || status === 'unavailable') return 'zero_stock';
  if (status === 'insufficient_stock' ||
      (row.unavailable?.length && !row.rows?.length)) return 'insufficient_stock';
  if (incomplete.has(status)) return 'catalog_incomplete';
  if (clarifications.has(status)) return 'clarification';
  if (status === 'outside_local_directory') return 'outside_coverage';
  return 'ok';
}

// One observation per basket line, retailer, or standalone lookup. The mapper
// only returns enumerated categories. No strings from source payloads pass through.
export function observations(operation, args, result) {
  if (operation.startsWith('pharmacy_')) operation = operation.slice(9);
  if (!operations.has(operation)) return [];
  const base = retailerId(args?.retailer ?? (operation.includes('_') ? 'Drogasil' : undefined));
  const rows = [];
  const add = (row, query, retailer = base) => rows.push({ operation, retailer, shape: queryShape(query), outcome: outcome(row) });
  if (operation === 'get_products' && Array.isArray(result.products)) {
    for (const product of result.products) add({ status: product ? 'matches' : 'unknown_sku' }, '1');
  } else if (operation === 'snapshot' && Array.isArray(result.runs)) {
    for (const run of result.runs) add(run, undefined, retailerId(run.retailerId));
  } else if (result.tables?.length) {
    result.tables.forEach((row, i) => add(row, args.items?.[i]?.query));
  } else if (result.scope === 'whole_basket_per_retailer') {
    for (const row of result.results) {
      const id = retailerId(row.retailerId);
      if (row.tables?.length) row.tables.forEach((table, i) => add(table, args.items?.[i]?.query, id));
      else add(row, undefined, id);
    }
  } else if (result.checkedRetailers?.length) {
    for (const row of result.checkedRetailers) {
      const issue = result.issues?.find(issue => issue.retailer === row.retailer && sourceProblems.has(issue.status));
      add(issue ?? row, args.query, retailerId(row.retailer));
    }
  } else if (result.results?.length) {
    result.results.forEach((row, i) => add(row, args.query ?? args.queries?.[i], row.retailerId ? retailerId(row.retailerId) : base));
  } else if (result.offers?.length) {
    const outcomes = result.offers.map(row => outcome({ ...row, status: row.localStatus }));
    const selected = outcomes.find(value => failures.has(value)) ?? (outcomes.every(x => x === 'zero_stock') ? 'zero_stock' : outcome(result));
    rows.push({ operation, retailer: base, shape: queryShape(args.sku), outcome: selected });
  } else {
    add(result, args.query ?? args.sku, result.retailerId ? retailerId(result.retailerId) : base);
  }
  return rows;
}

export function createMonitoring(dsn, { send = fetch, warn = message => console.error(message), intervalMs = 60000, journal = line => console.error(line) } = {}) {
  if (!dsn) return null;
  const parsed = makeDsn(dsn);
  if (!parsed || parsed.protocol !== 'https' || parsed.pass) throw new Error('Expected an HTTPS Sentry public client DSN');
  const url = getEnvelopeEndpointWithUrlEncodedAuth(parsed);
  const totals = new Map();
  let drops = 0;
  const transport = createTransport({ bufferSize: 32, recordDroppedEvent: () => { drops++; } }, async ({ body }) => {
    const response = await send(url, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' },
      body, redirect: 'error', signal: AbortSignal.timeout(4000) });
    if (!response.ok && response.status !== 413) drops++;
    return { statusCode: response.status, headers: { 'retry-after': response.headers.get('retry-after'),
      'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits') } };
  });
  function submit(envelope) {
    // The SDK tracks transport failures and enforces Sentry's quota backoff.
    void Promise.resolve(transport.send(envelope)).catch(() => {});
  }
  function record(observation) {
    const { operation, retailer, shape, outcome } = observation;
    const key = JSON.stringify([operation, retailer, shape, outcome]);
    totals.set(key, (totals.get(key) ?? 0) + 1);
    if (!failures.has(outcome)) return;
    // A safe local record remains available to the operator during transport outages.
    journal(JSON.stringify({ event: 'farmacias.lookup_issue', release, ...observation }));
    const id = uuid();
    submit([{ event_id: id }, [[{ type: 'event' }, {
      event_id: id, timestamp: Date.now()/1000, platform: 'node', release, environment: 'production',
      level: ['service_exit','upstream_failure','timeout','handler_exception','canary_mismatch'].includes(outcome) ? 'error' : 'warning',
      message: 'Farmácias BR · ' + operation + ' · ' + outcome,
      fingerprint: ['farmacias-br', operation, retailer, outcome, shape],
      tags: { operation, retailer, shape, outcome },
    }]]]);
  }
  function flushCounts() {
    const items = [];
    for (const [key, value] of totals) {
      const [operation, retailer, shape, outcome] = JSON.parse(key);
      const attributes = Object.fromEntries(Object.entries({ operation, retailer, shape, outcome, release, environment: 'production' })
        .map(([k,v]) => [k, { type: 'string', value: v }]));
      items.push({ name: 'farmacias.lookup.outcomes', type: 'counter', value,
        timestamp: Date.now()/1000, trace_id: uuid(), attributes });
    }
    totals.clear();
    if (items.length) submit([{}, [[{ type: 'trace_metric', item_count: items.length,
      content_type: 'application/vnd.sentry.items.trace-metric+json' }, { version: 2, items }]]]);
    if (drops) { warn('Farmácias BR monitoring: ' + drops + ' dropped delivery units'); drops = 0; }
  }
  function observe(operation, args, result, errorOutcome) {
    try {
      for (const entry of observations(operation, args, result)) {
        record(errorOutcome ? { ...entry, outcome: errorOutcome } : entry);
      }
    } catch { drops++; }
  }
  const timer = setInterval(flushCounts, intervalMs);
  timer.unref();
  return {
    async run(operation, args, handler) {
      let result;
      try { result = await handler(); }
      catch (error) {
        const timedOut = ['TimeoutError','AbortError'].includes(error?.name) ||
          ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code);
        observe(operation, args, {}, timedOut ? 'timeout' : 'handler_exception');
        throw error;
      }
      observe(operation, args, result?.structuredContent ?? result ?? {});
      return result;
    },
    canary(passed, kind) {
      const shape = ['release','pack','form'].includes(kind) ? kind : 'unspecified';
      record({ operation: 'presentation_canary', retailer: 'drogasil', shape, outcome: passed ? 'ok' : 'canary_mismatch' });
    },
    serviceExit() { record({ operation: 'service', retailer: 'all', shape: 'unspecified', outcome: 'service_exit' }); },
    async close() { clearInterval(timer); flushCounts(); return await transport.flush(4500); },
  };
}
