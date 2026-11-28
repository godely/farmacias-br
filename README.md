# Farmácias BR

Uma API para consultar Drogasil, Pague Menos e Drogaria São Paulo. A mesma consulta pode ser feita pelo terminal, por HTTP e por clientes MCP. A pessoa pode compartilhar um CEP ou suas coordenadas. Cada rede confirma a disponibilidade na área que atende.

Para buscar uma caixa perto de você nas três redes, use, por exemplo, `farmacias plan "ibuprofeno 600 mg 20 comprimidos" --cep "$CEP"`. Para escolher uma rede, acrescente `--retailer paguemenos`. Para escolher duas, use `--retailers drogasil,drogariasaopaulo`. No plugin, pergunte “Onde eu acho ibuprofeno perto de mim?” e escolha a apresentação quando o assistente perguntar. Na resposta, a Drogasil informa estoque da filial. As outras duas redes confirmam a retirada para a quantidade solicitada.

## Instalar e consultar

Em uma cópia deste repositório, execute `npm ci` com Node.js 20 ou superior. Use `node bin/farmacias.js` ou instale o pacote com `npm install -g .` para usar o comando `farmacias`. Python 3 e curl são usados para snapshots e páginas de oferta da Drogasil.

```sh
farmacias retailers
farmacias search dipirona --limit 3
farmacias suggest morfi
farmacias search morfina --retailer paguemenos
farmacias product 81128 --retailer drogasil
farmacias stock 81128 --retailer drogasil --cep "$CEP"
farmacias prices 81128 --retailer drogasil --cep "$CEP"
```

Cada SKU pertence a uma rede. A comparação entre redes valida o código de barras e a apresentação antes de ordenar as ofertas pelo preço. O resultado separa valores verificados para a localização informada de ofertas de vitrine. Frete e descontos de programas pessoais podem alterar o total. A busca no catálogo e a consulta de informações de um produto funcionam sem CEP.

Na Pague Menos e na Drogaria São Paulo, uma busca por nome incompleto ou com erro pode pedir confirmação. O MCP devolve uma proposta e a pergunta “Você quis dizer …?”. Após “sim”, o cliente chama `pharmacy_search` com `confirmation.onYes`. Após “não”, chama `pharmacy_suggest` com `confirmation.onNo` para mostrar as outras sugestões. Se a pessoa pedir a lista completa, envie `listAll: true` a `pharmacy_suggest`. O endpoint `POST /api/v1/suggest` e a CLI também permitem consultar os termos. Cada produto da busca da Pague Menos inclui os princípios ativos informados pelo catálogo em `activeIngredients`. Uma lista vazia indica informação ausente.

A busca usa o vocabulário DCB de julho de 2026 e o resolvedor de princípios ativos e marcas da biblioteca Drogasil para identificar o nome pedido. Na Drogaria São Paulo, a busca consulta o campo Princípio Ativo. A confirmação mantém a rede e a apresentação pedidas. Se a Drogasil estiver indisponível, a busca pode usar as sugestões da própria Pague Menos. Os nomes DCB vêm das colunas de identificador e denominação da [planilha oficial da ANVISA](https://bibliotecadigital.anvisa.gov.br/jspui/bitstream/anvisa/21318/1/2-Lista%20DCB%20consolidada%20jul%202026.xlsx). Para atualizar o vocabulário, use o [importador de drogasil-cli](https://github.com/godely/drogasil-cli/blob/main/scripts/build-dcb-names.py) e atualize a revisão da dependência. A planilha enriquecida com marcas não é necessária para gerar o arquivo.


| Rede | Evidência de disponibilidade |
|---|---|
| Drogasil | Quantidade reportada por filial, distância e alcance da busca. O preço de catálogo é de referência. |
| Pague Menos e Drogaria São Paulo | Simulação de atendimento por CEP ou coordenadas, SKU e vendedor, com entrega ou retirada quando informada. A quantidade consultada é o pedido simulado. |

## Biblioteca, HTTP e MCP

```js
import { searchCatalog, comparePrices } from 'farmacias-br';
const catalog = await searchCatalog({ query: 'dipirona', limit: 3 });
const prices = await comparePrices({ query: '81128', retailer: 'drogasil', zipcode: process.env.CEP });
```

`farmacias-mcp` usa stdio. `farmacias-mcp --http --port 8787` inicia um serviço em 127.0.0.1 com MCP em `/mcp`. A interface HTTP oferece `GET /api/v1/retailers` e `POST /api/v1/<operação>` com os mesmos parâmetros JSON da biblioteca. Ao usar acesso remoto, proteja o serviço com a autenticação do seu proxy. As operações de consulta não fazem compras.

Os MCPs `pharmacy_search`, `pharmacy_product`, `pharmacy_stock` e `pharmacy_prices` atendem as três redes. As ferramentas originais da Drogasil continuam disponíveis. As operações por rede e as diferenças de cobertura estão na tabela de funções abaixo. O plano de retirada da Drogasil cobre somente suas filiais.

Os três adaptadores são projetos independentes. [Drogasil](https://github.com/godely/drogasil-cli) · [Pague Menos](https://github.com/godely/paguemenos-cli) · [Drogaria São Paulo](https://github.com/godely/drogariasaopaulo-cli).

## Verificação

Execute `npm test` para testar contratos, falhas parciais, entradas inválidas, leituras concorrentes e os transportes stdio e HTTP. A auditoria com consultas reais aceita um TSV local com UF, município e CEP e um SKU da Drogasil. Cada linha de saída contém o estado, município e resultados das redes. Exemplo de chamada: `node scripts/regional-audit.mjs origens.tsv 81128`. Nenhum CEP é configurado como padrão.

O serviço aceita monitoramento opcional no Sentry, com ocorrências agrupadas e contagens separadas de falta de estoque. [Configuração e revisão em lote](docs/monitoring.md).

## Plugin no Codex e no Claude Code

O plugin reúne o servidor MCP e três skills. Cada cliente instala a mesma versão do serviço. O modo portátil usa Node e npx no computador do cliente e baixa o código de uma revisão específica no GitHub na primeira execução.

```sh
codex plugin marketplace add godely/farmacias-br
codex plugin add farmacias-br@farmacias-brasil
claude plugin marketplace add godely/farmacias-br
claude plugin install farmacias-br@farmacias-brasil
```

Em uma instalação remota pessoal, aponte o conector do cliente para o caminho autenticado `/mcp` do seu servidor. O endpoint e as credenciais pertencem à configuração privada de cada cliente. Para instalar no Claude Desktop as três skills junto com o MCP remoto, gere o arquivo na sua máquina e carregue-o em Plugins → Adicionar → Fazer upload. O cliente autentica a conexão depois da instalação.

```sh
python3 scripts/package-remote-plugin.py --url "$MCP_URL" --output farmacias-br.zip
```

## Amostra de cobertura nacional

Em 27 de novembro de 2026, verificamos uma apresentação de paracetamol em um CEP de cada capital das 26 unidades estaduais e do Distrito Federal. Pague Menos confirmou oferta para os 27 CEPs e Drogaria São Paulo para 15. A Drogasil informou filiais em 22 das 27 janelas iniciais de estoque. Esse teste mede a resposta das fontes para a amostra; o atendimento depende de CEP, produto e momento.

Repetimos a comparação nas 27 capitais e em Parintins (AM), Petrolina (PE), Catalão (GO), Viçosa (MG) e Lages (SC). Para a mesma apresentação, pelo menos uma rede confirmou uma oferta em cada um dos 32 CEPs. Pague Menos confirmou em 31 e Drogaria São Paulo em 19. São observações de uma caixa por CEP na data do ensaio.

A consulta de estoque da Drogasil também aceita `--lat` e `--lon` ou um objeto JSON `coordinates` com `latitude` e `longitude`. Os parceiros também verificam atendimento usando coordenadas na consulta de estoque. A comparação de preços e a cotação da cesta inteira aceitam a mesma origem. Por exemplo, use `farmacias prices paracetamol --lat "$LAT" --lon "$LON"` para reutilizar coordenadas compartilhadas. Quando o catálogo de referência não identifica um nome, a API procura candidatos nos demais catálogos para que a pessoa escolha uma apresentação.

A resposta de preços inclui as modalidades que cada rede confirmou, taxas informadas e identificação e endereço dos pontos de retirada. Uma opção de retirada confirma o atendimento simulado para aquela quantidade. Para repetir o ensaio local de concorrência, rejeição de entradas e persistência de mil produtos, execute `node scripts/stress.mjs` na cópia de desenvolvimento. O ensaio usa o serviço em loopback e um catálogo sintético.

## Funções verificáveis por rede

| Consulta | Drogasil | Pague Menos e Drogaria São Paulo |
|---|---|---|
| Catálogo, SKU, lote de SKUs e GTIN | Sim | Sim |
| Informações por nome ou SKU, sem CEP | Ficha estruturada e fontes regulatórias no MCP específico | Título e campos publicados pela rede |
| Marca e genéricos da mesma apresentação | Comparação no catálogo Drogasil | Equivalência do catálogo de referência e embalagem confirmada na rede |
| Preço e atendimento local | Estoque por filial e preço de referência | Simulação por CEP ou coordenadas, SKU, vendedor e quantidade |
| Cesta de vários produtos | Planejamento de paradas e percurso | Simulação conjunta, pontos de retirada comuns e subtotal dos produtos quando confirmado |
| Diretório de lojas | Sim | Pague Menos oferece levantamento nacional datado e localizador ao vivo por origem. Drogaria São Paulo oferece diretório nacional das filiais identificadas |
| Consulta na filial mais próxima | Quantidade informada na filial | Retirada para a quantidade pedida na filial mais próxima do diretório com distância conhecida |
| Ampliação consentida para 25 km | Sim | Cobertura física sem confirmação |
| Snapshot com paginação de leitura | Sim | Sim, com ofertas por SKU |

A CLI, a biblioteca, o HTTP e o MCP compartilham o registro de operações. Os nomes MCP usam o prefixo `pharmacy_`. Para operações em outras redes, escolha o identificador da rede em `pharmacy_retailers`. Os dados de preço e estoque sempre pertencem à rede consultada. A equivalência é limitada aos genéricos que o catálogo de referência consegue identificar e cuja embalagem consta na rede selecionada. Uma classificação, concentração ou retenção ausente fica sem confirmação.

```sh
farmacias product --gtin 7899547543766 --retailer paguemenos
farmacias info Tylenol loratadina --retailer drogariasaopaulo
farmacias info Rivotril tansulosina --retailers paguemenos,drogariasaopaulo
farmacias compare 3530 --retailer drogariasaopaulo --generics
farmacias basket 3179:1 1633706:2 --retailer paguemenos --cep "$CEP"
farmacias stores --retailer drogasil --limit 5
farmacias stores --retailers paguemenos,drogariasaopaulo --cep "$CEP" --limit 3
farmacias snapshot loratadina paracetamol --retailer drogariasaopaulo --max-items 10
farmacias snapshot --retailers drogasil,paguemenos --max-items 1
farmacias read_snapshot "$RUN_ID" --limit 5
```

Quando a coleta omite os termos, ela pesquisa paracetamol nas redes escolhidas. O limite padrão é de 20 produtos por rede.

Para conferir a coleta padrão nas sete combinações pelo CLI e pelo MCP, execute `node scripts/check-snapshot-scopes.mjs`. O teste ao vivo limita cada coleta a um produto por rede e confere a exportação. Para testar um termo explícito, passe-o como argumento.

O teste de aceitação chama o MCP por stdio contra os catálogos reais, exercita os dois CEPs informados no momento do teste e descarta seu banco temporário de snapshots. Ele valida separadamente o escopo do preço, a quantidade consultada, o vendedor e a opção de retirada comum. Execute `node scripts/check-retailer-workflows.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"` com dois CEPs de teste para as cotações. O número de lojas e os preços variam.

Para conferir a filial mais próxima nas duas redes parceiras, execute `node scripts/check-fixed-branch-pickup.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"`. A verificação cruza as respostas dos CLIs e do MCP com o diretório e a oferta de retirada publicados pela própria rede.

Para verificar também os executáveis dos dois pacotes parceiros publicados no GitHub, execute `node scripts/check-sibling-clis.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"`. O teste cobre os oito comandos de referência, sugestões, código de barras, comparações locais, cestas, diretórios e exportação dos snapshots em JSON, CSV e XLSX.

Para conferir a confirmação de nomes nos três executáveis e verificar o princípio ativo após a escolha, execute `node scripts/check-standalone-names.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"`.

Use `farmacias prices GTIN --cep CEP --retailers paguemenos,drogariasaopaulo` para restringir as ofertas às redes escolhidas. A opção `--retailer` em preços identifica o dono de um SKU local. Para uma cesta inteira use `farmacias baskets GTIN:2 OUTRO_GTIN:1 --cep CEP --retailers paguemenos,drogariasaopaulo`. As mesmas consultas estão disponíveis como `pharmacy_prices` e `pharmacy_baskets`.

Para comparar as mesmas embalagens nas sete combinações de redes pelo CLI e pelo MCP, execute `node scripts/check-selected-retailers.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"`. Para repetir a mesma matriz com coordenadas, use `node scripts/check-selected-retailers.mjs --coordinates "$LAT_A,$LON_A" "$LAT_B,$LON_B"`. Para comparar uma marca com genéricos em várias redes, use `farmacias compare "Frontal 2 mg 30 comprimidos de liberação imediata" --generics --retailers drogasil,drogariasaopaulo` ou `pharmacy_compare` com o mesmo nome e as redes escolhidas. Sem uma seleção, a busca inclui as três. Acrescente a localização quando quiser conferir estoque ou retirada. O teste ao vivo `node scripts/check-selected-presentations.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"` verifica as sete seleções com e sem localização pelo CLI e pelo MCP. Para cestas por nome, `plan_purchase` aceita o identificador da rede em `retailer`. A consulta conjunta da Pague Menos e da Drogaria São Paulo confirma quantidades para retirada ou entrega. O estoque físico por filial permanece desconhecido.

Para uma lista por nome em várias redes, `farmacias plan` e `plan_purchase` também retornam `crossRetailerPlans`. Cada plano completo informa o que pegar em cada endereço, o número de paradas e o total estimado dos produtos. A comparação considera os planos verificados, com estoque informado pela Drogasil e retirada oferecida pelas outras redes. O trajeto estimado sai da origem, visita as filiais e volta à origem. As distâncias são em linha reta. Se faltarem coordenadas, o total do trajeto fica desconhecido. Taxas ficam fora do subtotal.

For shopping at one partner chain, `plan_purchase` and `farmacias plan` include `pickupPlans` for multi-item requests. These rank verified pickup itineraries by fewest branches and lowest product subtotal. Multiple items at one partner branch require a joint checkout quote. Fees are separate. Responses identify incomplete searches and unknown prices or distances.

Para testar uma cesta que exige duas redes, execute `node scripts/check-retained-basket.mjs "$CEP_TESTE" split-pickup`. O teste usa Dimorf em gotas e solução fisiológica Dauf Pro Soro 500 mL. Verifica a quantidade informada pela Drogasil, a oferta de retirada da Pague Menos, as duas paradas, a soma dos preços e as escolhas após nova consulta. O resultado depende das ofertas atuais na região do CEP. Para testar a cesta de Dimorf e spray nasal Ever Care na Pague Menos e na Drogaria São Paulo, use o mesmo comando com `ever-care`.

Para conferir a comparação de apresentações registradas, execute `node scripts/check-registered-comparison.mjs "$CEP_TESTE"`. Com consentimento para comparar genéricos, o teste consulta Sinvasmax na Pague Menos e na Drogaria São Paulo. Onde a marca aparece, ela vem primeiro, com a própria cotação. Cada genérico traz o preço e a oferta de retirada que a rede publicou para aquela embalagem. A indicação de retirada vale para a quantidade solicitada. A [Anvisa explica a regra de troca de um similar prescrito](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/similares).
