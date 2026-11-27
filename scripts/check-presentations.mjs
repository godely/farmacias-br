// These are repeatable catalog checks. They never request a user's location or stock.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createMonitoring } from '../src/monitoring.js';

const monitor = createMonitoring(process.env.FARMACIAS_SENTRY_DSN);
const client = new Client({ name: 'farmacias-presentation-check', version: '1' });
const cases = [
  ['release', 'Frontal 2 mg 30 comprimidos de liberação imediata', '88262', '28619'],
  ['release', 'Frontal 2 mg de liberação prolongada, com 30 comprimidos', '28619', '88262'],
  ['form', 'Patz GTS em gotas, frasco de 20 mL', '913628'],
  ['pack', 'Patz GTS em gotas, frasco de 30 mL', null, '913628'],
];
try {
  // A separate instance keeps the deliberately impossible pack out of user miss rates.
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../bin/server.js', import.meta.url))], env: { FARMACIAS_SENTRY_DSN: '' } }));
  for (const [kind, query, expected, excluded] of cases) {
    const response = await client.callTool({ name: 'compare_products', arguments: { query, includeGenerics: false } });
    const data = response.structuredContent;
    const skus = data?.products?.map(p => String(p.sku));
    const passed = !response.isError && Array.isArray(skus) && !skus.includes(excluded) &&
      (expected ? skus.includes(expected) : data.status === 'no_reference' && skus.length === 0);
    monitor?.canary(passed, kind);
    console.log(kind, passed ? 'passed' : 'failed');
    if (!passed) process.exitCode = 1;
  }
} catch {
  monitor?.serviceExit();
  console.error('Presentation check could not complete');
  process.exitCode = 1;
} finally {
  await client.close();
  await monitor?.close();
}
