import {medicationIntent, isDcbName} from 'drogasil-cli/medication-catalog';
import {resolveMedication} from 'drogasil-cli';

// Preserve full catalog queries for merchandise. Only treat trailing words
// after a possible misspelling as a presentation when they look like one.
const presentation = /^(?:\d|(?:em|com|de|xr|cr|sr|sl|gotas?|frasco|solucao|comprimidos?|capsulas?|spray|gel|pomada|suspensao|sublingual|liberacao)\b)/;
const catalogTerms = new Set(['gel','spray','diet','dor','protetor','creme','kit','cha','oleo','solucao','pomada','gotas']);
export async function nameChoices(query, {intentFor = medicationIntent, resolve = resolveMedication} = {}) {
  const intent = await intentFor(query);
  if (catalogTerms.has(intent.name) || !intent.suggestions.length || (intent.suffix && !presentation.test(intent.suffix))) return [];
  const candidates = intent.suggestions.slice(0, 7);
  if (candidates.length === 1) return candidates;
  const suffix = intent.suffix ? ' ' + intent.suffix : '';
  const confirmedIngredients = await Promise.all(candidates.map(async term => {
    const name = suffix ? term.slice(0, -suffix.length) : term;
    if (!isDcbName(name)) return 'other';
    const resolved = await resolve(name).catch(() => null);
    if (!resolved) return 'unverified';
    return resolved.kind === 'ingredient' && !resolved.interpretation ? 'current' : 'other';
  }));
  const ingredients = candidates.filter((_, i) => confirmedIngredients[i] !== 'other');
  if (ingredients.length >= 2) return ingredients;
  return [ingredients[0] ?? candidates[0]];
}

export function namePrompt(choices) {
  return 'Você quis dizer ' + new Intl.ListFormat('pt-BR', {type:'disjunction'}).format(choices) + '?';
}

export function choiceFollowup(choices, tool, select, alternatives) {
  const question = namePrompt(choices);
  if (choices.length > 1) {
    return {nameChoice:{question, options:choices.map(term => ({term, onSelect:select(term)}))}};
  }
  return {confirmation:{
    question, onYesTool:tool, onYes:select(choices[0]), onNoTool:'pharmacy_suggest',
    onNo:{...alternatives, declinedTerm:choices[0]},
  }};
}
