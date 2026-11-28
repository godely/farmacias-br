import { nameChoices, namePrompt } from 'drogasil-cli/medication-catalog';
export { nameChoices };

export function choiceFollowup(choices, tool, select, alternatives) {
  const question = namePrompt(choices);
  if (choices.length > 1) {
    return {nameChoice:{question, tool, options:choices.map(term => ({term, onSelect:select(term)}))}};
  }
  return {confirmation:{
    question, onYesTool:tool, onYes:select(choices[0]), onNoTool:'pharmacy_suggest',
    onNo:{...alternatives, declinedTerm:choices[0]},
  }};
}

export async function clarifyLookup(tool, args, scope, clarify = nameChoices) {
  const queries = args.queries ?? [args.query];
  for (const [index, query] of queries.entries()) {
    if (/^\d+$/.test(query)) continue;
    const choices = await clarify(query);
    if (!choices.length) continue;
    const select = term => args.queries
      ? {...args, queries:queries.map((text, i) => i === index ? term : text)}
      : {...args, query:term};
    return {status:'needs_name_confirmation', ...choiceFollowup(choices, tool, select, {...scope,query})};
  }
}
