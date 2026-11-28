export const instructions = 'Identifique o nome digitado para uma busca em farmácias brasileiras. Escolha um único candidato somente se a grafia, um prefixo ou uma tradução indicar claramente aquele nome. Uma correção será apresentada para confirmação. Se faltar o nome correspondente, houver vários plausíveis ou o termo for desconhecido, peça esclarecimento. Preserve a identidade da marca ou do princípio ativo. Não substitua por outro medicamento. Dose e embalagem não autorizam trocar de nome.';

const endpoints = {
  openai:{url:'https://api.openai.com/v1/decisions',key:'OPENAI_API_KEY',model:'gpt-6-luna'},
  jev:{url:'https://api.typesafe.ai/v1/systemone',key:'JEV_API_KEY',model:'jev-latest'},
};

export function orderedChoices(candidates, evidence, caseId, round) {
  const shift = candidates.length ? caseId % candidates.length : 0;
  const order = candidates.slice(shift).concat(candidates.slice(0,shift));
  if (round%2) order.reverse();
  const options = order.map((name,i)=>({id:'n'+(i+1),description:name+' ('+evidence[name].sources.join(', ')+')',name}));
  options.splice((caseId+round%2)% (options.length+1),0,{id:'clarify',description:'Pedir esclarecimento à pessoa.',name:null});
  return options;
}

export async function classify(provider,query,options) {
  const {url,key,model} = endpoints[provider];
  const credential = process.env[key];
  if (!credential) throw Error('Missing '+key);
  const choices = options.map(({id,description})=>({value:id,description}));
  const criteria = Object.fromEntries(choices.map(({value,description})=>[value,description]));
  const body = provider==='openai'
    ? {model,input:query,questions:[{name:'identity',type:'choice',instructions,choices}]}
    : {model,state:query,questions:{identity:{type:'choice',instructions,criteria}}};
  const start = performance.now();
  let response;
  try {
    response = await fetch(url,{method:'POST',redirect:'error',headers:{
      Authorization:'Bearer '+credential,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  } catch {return {error:'transport',ms:Math.round(performance.now()-start)};}
  if (!response.ok) return {error:'http_'+response.status,ms:Math.round(performance.now()-start)};
  let data;
  try {data=await response.json();} catch {return {error:'invalid_json',ms:Math.round(performance.now()-start)};}
  const answer = provider==='openai' ? data.answers?.find(a=>a.name==='identity') : data.answers?.identity;
  const option = answer?.type==='choice' && options.find(o=>o.id===answer.choice);
  const observation = {model:data.model,ms:Math.round(performance.now()-start),usage:data.usage};
  return option ? {...observation,pick:option.name} : {...observation,error:'invalid_choice_or_refusal'};
}
