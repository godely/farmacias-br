# Resolução de nomes de medicamentos no Brasil

Em 28 de novembro de 2026, o Farmácias BR comparou seu resolvedor local com o OpenAI Decisions (`gpt-6-luna`) e o Jev (`jev-1.14.0`). A tarefa era sugerir um nome documentado para a pessoa confirmar ou pedir esclarecimento. Selecionar uma marca ou substância diferente contou como erro, mesmo quando as duas estavam relacionadas.

| Resultado em 264 decisões por resolvedor | Local | OpenAI Decisions | Jev |
|---|---:|---:|---:|
| Sugeriu o nome correto | 152 | 148 | 172 |
| Pediu esclarecimento quando necessário | 88 | 88 | 80 |
| Sugeriu um nome indevido | 4 | 4 | 12 |
| Pediu esclarecimento apesar de o nome correto estar entre os candidatos | 20 | 24 | 0 |
| Latência mediana / p95 | 2,1 / 3,8 ms | 295 / 362 ms | 194 / 234 ms |
| Custo estimado em US$ por mil chamadas à API | — | 0,02311 | 0,01930 |

**Decisão.** Manter a identificação local em produção. O Jev recuperou as oito grafias difíceis quando recebeu uma lista contendo a identidade correta, mas escolheu prednisolona quando a pessoa pediu prednisona e a lista omitia prednisona. O Decisions pediu esclarecimento nesse caso. Em duas rodadas, porém, sugeriu morfina para “Dimorf em gotas” quando a lista omitia a marca. Nenhum dos dois resultados justifica aceitar uma substituição de identidade. A economia observada do Jev foi de cerca de US$ 0,00381 por mil chamadas.

**Onde o sistema perde nomes.** Em cinco das oito grafias difíceis, a recuperação de candidatos em produção devolveu uma lista vazia. O nome correto estava disponível em 31 de 36 cenários de identidade definida que usavam a recuperação real. Um serviço limitado aos nomes documentados só pode ajudar se o nome estiver nessa lista. Para “dexa”, a seleção local também sugeriu um único ingrediente em um caso rotulado como ambíguo. A prioridade é melhorar a recuperação e permitir que a pessoa escolha entre alternativas plausíveis. A verificação de forma, dose, liberação, embalagem e oferta continua necessária após a confirmação do nome.

## Como o teste foi feito

- Fixamos 66 cenários com 55 consultas sintéticas distintas. Há nomes exatos, prefixos, traduções, transposições, erros fortes de grafia, nomes parecidos e inventados. Alguns termos reaparecem com outra lista para isolar o efeito da recuperação.
- Os cenários comuns usam até sete candidatos do resolvedor atual. Nos cenários controlados, a lista inclui concorrentes plausíveis, omite a identidade pedida ou devolve deliberadamente um nome difícil de recuperar. Todos os nomes candidatos têm evidência na DCB ou no catálogo da Drogasil. O arquivo `cases.json` contém os rótulos definidos antes das chamadas. Os provedores recebem apenas o texto sintético, os candidatos com sua fonte e a opção de pedir esclarecimento.
- Rodamos duas ordens de candidatos, duas vezes cada, nas duas APIs em paralelo. Em cada serviço houve 236 chamadas, sete listas vazias por rodada resolvidas localmente e zero falhas de transporte ou resposta. As repetições servem para medir estabilidade. Não são 264 casos independentes. Cada serviço repetiu suas respostas com a mesma ordem. Ao alternar a ordem, o Decisions mudou de resposta em seis cenários. O Jev manteve suas escolhas.
- O resultado local vem das funções de produção com o índice já carregado. Nas listas controladas, uma sugestão fora da lista conta como pedido de esclarecimento. As latências externas incluem a viagem de rede a partir do Mac de teste. Latência no Jetson, desempenho clínico e taxa de erro no tráfego dos usuários não foram medidos neste estudo.
- Calculamos os custos com os contadores devolvidos: **54.540** tokens de entrada no Decisions e **108.432** no Jev. Nenhuma chamada reportou leitura ou gravação de cache. Aos preços publicados, as rodadas custaram respectivamente **US$ 0,005454** e **US$ 0,004554**, antes de qualquer crédito ou ajuste de fatura. O teste inicial de conectividade está fora desses totais. [Preços do Decisions](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability) · [Preços do Jev](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost)

## Reprodução

Recalcule todas as métricas, os casos com erros e as contagens por categoria sem chamar APIs:

```sh
node benchmarks/names/report.mjs benchmarks/names/2026-11-28.json.gz
```

Para repetir as chamadas, forneça `OPENAI_API_KEY` e `JEV_API_KEY` no ambiente e informe um novo arquivo de resultados. Cada provedor recebe apenas a própria credencial. A rodada usa o catálogo congelado em `catalog.json`. Para coletar novamente os candidatos e medir a latência local com o catálogo do dia, execute `node benchmarks/names/capture.mjs` em uma cópia separada antes da rodada. A lista de candidatos pode mudar entre datas.

```sh
node benchmarks/names/run.mjs /tmp/farmacias-decisions-new.json
node benchmarks/names/report.mjs /tmp/farmacias-decisions-new.json
```

A resposta aceita somente uma opção enviada na pergunta. Uma falha do provedor, recusa ou resposta inválida fica separada de um pedido de esclarecimento. O arquivo da medição registra as escolhas e os contadores por cenário. [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) · [Contrato da API do Jev](https://api.typesafe.ai/docs)
