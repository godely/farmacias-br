// Only the two fixed benchmark suites can be sent to a provider.
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {question, readAnswer, services, summarize} from './decision.mjs';

const {values} = parseArgs({options: {
  provider: {type: 'string'}, model: {type: 'string'},
  suite: {type: 'string', default: 'fixtures'}, offline: {type: 'boolean'},
}});
const {provider, suite} = values;
const suites = {fixtures: 'cases.json', catalog: 'catalog-cases.json'};
if (!Object.hasOwn(suites, suite)) throw Error('Choose --suite fixtures or --suite catalog');
if (!Object.hasOwn(services, provider)) throw Error('Choose --provider openai or --provider jev');
const {url, key, model} = services[provider];
const apiKey = process.env[key];
if (!values.offline && !apiKey) throw Error('Configure ' + key + ' or use --offline');
const cases = JSON.parse(await readFile(new URL(suites[suite], import.meta.url), 'utf8'));
const results = [];
for (const sample of cases) {
  for (const reverse of sample.candidates.length > 1 ? [false, true] : [false]) {
    const {body, expected, options} = question(provider, values.model ?? model, sample, reverse);
    if (values.offline) continue;
    const start = performance.now();
    let result;
    try {
      const response = await fetch(url, {
        method: 'POST', headers: {Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(12000), redirect: 'error',
      });
      if (!response.ok) {
        if ([400, 401, 402, 403, 404, 429].includes(response.status)) throw Error('Stop evaluation: HTTP ' + response.status);
        throw Error('HTTP ' + response.status);
      }
      result = readAnswer(provider, await response.json(), options);
    } catch (error) {
      if (error.message.startsWith('Stop evaluation:')) throw error;
      result = {outcome: 'error', reason: error.message};
    }
    const row = {id: sample.id, reverse, expected, ...result, ms: Math.round(performance.now() - start)};
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
if (values.offline) {
  console.log(JSON.stringify({provider, suite, fixtures: cases.length, mode: 'request_construction_only'}));
} else {
  const summary = summarize(cases, results);
  console.log(JSON.stringify({provider, suite, ...summary}));
  if (summary.correct !== summary.requests) process.exitCode = 1;
}
