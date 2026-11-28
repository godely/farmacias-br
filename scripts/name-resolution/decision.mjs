const instructions = 'Ajude a identificar o nome ou a apresentação pedida em uma farmácia brasileira. ' +
  'Os candidatos são registros do catálogo. Escolha o que corresponde ao pedido, considerando grafia, abreviações e fatos documentados. ' +
  'Respeite marca explícita, concentração, forma, liberação e embalagem. Uma menção em uma bula não identifica o princípio ativo. ' +
  'Se faltar um detalhe para validar a apresentação ou mais de uma interpretação for plausível, escolha esclarecer. ' +
  'Se os candidatos forem incompatíveis com o pedido, escolha nenhuma. O resultado serve para esclarecer a busca.';

export const services = {
  openai: {url: 'https://api.openai.com/v1/decisions', key: 'OPENAI_API_KEY', model: 'gpt-6-luna'},
  jev: {url: 'https://api.typesafe.ai/v1/systemone', key: 'TYPESAFE_API_KEY', model: 'jev-latest'},
};

export function question(provider, model, sample, reverse) {
  const entries = sample.candidates.map((record, index) => ({record, index}));
  if (reverse) entries.reverse();
  const candidates = Object.fromEntries(entries.map(({record}, index) => ['c' + (index + 1), record]));
  const options = {...candidates, nenhuma: 'Nenhum candidato corresponde.', esclarecer: 'Falta informação para escolher com segurança.'};
  const context = {pedido: sample.query, candidatos: candidates};
  const expected = typeof sample.expected === 'number'
    ? 'c' + (1 + entries.findIndex(entry => entry.index === sample.expected))
    : sample.expected;
  if (!Object.hasOwn(options, expected)) throw Error('Unexpected answer key in ' + sample.id);
  if (provider === 'openai') {
    const choices = Object.entries(options).map(([value, description]) => ({value, description}));
    const body = {model, input: JSON.stringify(context), questions: [{name: 'identity', type: 'choice', instructions, choices}]};
    return {body, expected, options};
  }
  if (provider !== 'jev') throw Error('Unknown provider');
  const body = {model, state: context, questions: {identity: {type: 'choice', instructions, criteria: options}}};
  return {body, expected, options};
}

export function readAnswer(provider, data, options) {
  const answer = provider === 'openai' ? data.answers?.find(item => item.name === 'identity') : data.answers?.identity;
  if (answer?.type === 'refusal') return {outcome: 'refusal'};
  if (answer?.type !== 'choice' || !Object.hasOwn(options, answer.choice)) throw Error('invalid_choice');
  const probability = provider === 'openai'
    ? answer.probabilities?.find(item => item.value === answer.choice)?.probability
    : answer.probabilities?.[answer.choice];
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw Error('invalid_probability');
  return {
    outcome: 'decision', choice: answer.choice, probability, model: data.model,
    inputTokens: data.usage?.input_tokens ?? null,
    cachedInputTokens: data.usage?.input_tokens_details?.cached_tokens ?? null,
  };
}

export function summarize(cases, rows) {
  const decisions = rows.filter(row => row.outcome === 'decision');
  const wrong = decisions.filter(row => row.expected !== row.choice);
  const latencies = decisions.map(row => row.ms).sort((a, b) => a - b);
  const groups = new Map(cases.map(sample => [sample.id, []]));
  for (const row of rows) groups.get(row.id).push(row);
  let correctCases = 0;
  let orderChanges = 0;
  for (const sample of cases) {
    const group = groups.get(sample.id);
    const expectedRuns = sample.candidates.length > 1 ? 2 : 1;
    if (group.length !== expectedRuns || group.some(row => row.outcome !== 'decision')) continue;
    if (group.every(row => row.choice === row.expected)) correctCases++;
    const choices = group.map(row => {
      if (!/^c\d+$/.test(row.choice)) return row.choice;
      const index = Number(row.choice.slice(1)) - 1;
      return row.reverse ? sample.candidates.length - 1 - index : index;
    });
    if (new Set(choices).size > 1) orderChanges++;
  }
  const middle = Math.floor(latencies.length / 2);
  const medianMs = latencies.length ? (latencies[middle] + latencies[Math.floor((latencies.length - 1) / 2)]) / 2 : null;
  return {
    cases: cases.length, correctCases, orderChanges, requests: rows.length, answered: decisions.length,
    correct: decisions.length - wrong.length, wrongCandidate: wrong.filter(row => /^c\d+$/.test(row.choice)).length,
    wrongClarification: wrong.filter(row => row.choice === 'esclarecer').length,
    wrongNoMatch: wrong.filter(row => row.choice === 'nenhuma').length,
    failures: rows.filter(row => row.outcome === 'error').length, refusals: rows.filter(row => row.outcome === 'refusal').length,
    medianMs, p95Ms: latencies[Math.ceil(latencies.length * .95) - 1] ?? null,
    inputTokens: decisions.length && decisions.every(row => Number.isFinite(row.inputTokens))
      ? decisions.reduce((total, row) => total + row.inputTokens, 0) : null,
  };
}
