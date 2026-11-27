# Farmácias BR

Uma API para consultar Drogasil, Pague Menos e Drogaria São Paulo. A mesma consulta pode ser feita pelo terminal, por HTTP e por clientes MCP. O CEP vem de quem consulta. Cada rede confirma a disponibilidade na área que atende.

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

Cada SKU pertence a uma rede. A comparação entre redes valida o código de barras e a apresentação antes de ordenar as ofertas pelo preço. O resultado separa valores verificados para o CEP de ofertas de vitrine. Frete e descontos de programas pessoais podem alterar o total. A busca no catálogo e a consulta de informações de um produto funcionam sem CEP.

Na Pague Menos e na Drogaria São Paulo, uma busca por nome incompleto ou com erro pode pedir confirmação. O MCP devolve uma proposta e a pergunta “Você quis dizer …?”. Após “sim”, o cliente chama `pharmacy_search` com `confirmation.onYes`. Após “não”, chama `pharmacy_suggest` com `confirmation.onNo` para mostrar as outras sugestões. Se a pessoa pedir a lista completa, envie `listAll: true` a `pharmacy_suggest`. O endpoint `POST /api/v1/suggest` e a CLI também permitem consultar os termos. Cada produto da busca da Pague Menos inclui os princípios ativos informados pelo catálogo em `activeIngredients`. Uma lista vazia indica informação ausente.

A busca usa o vocabulário DCB de julho de 2026 e o resolvedor de princípios ativos e marcas da biblioteca Drogasil para identificar o nome pedido. Na Drogaria São Paulo, a busca consulta o campo Princípio Ativo. A confirmação mantém a rede e a apresentação pedidas. Se a Drogasil estiver indisponível, a busca pode usar as sugestões da própria Pague Menos. Os nomes DCB vêm das colunas de identificador e denominação da [planilha oficial da ANVISA](https://bibliotecadigital.anvisa.gov.br/jspui/bitstream/anvisa/21318/1/2-Lista%20DCB%20consolidada%20jul%202026.xlsx). Para atualizar o vocabulário, use o [importador de drogasil-cli](https://github.com/godely/drogasil-cli/blob/main/scripts/build-dcb-names.py) e atualize a revisão da dependência. A planilha enriquecida com marcas não é necessária para gerar o arquivo.


| Rede | Evidência de disponibilidade |
|---|---|
| Drogasil | Quantidade reportada por filial, distância e alcance da busca. O preço de catálogo é de referência. |
| Pague Menos e Drogaria São Paulo | Simulação de atendimento do CEP por SKU e vendedor, com entrega ou retirada quando informada. A quantidade consultada é o pedido simulado. |

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

A consulta de estoque da Drogasil também aceita `--lat` e `--lon` ou um objeto JSON `coordinates` com `latitude` e `longitude`. Os adaptadores que verificam a entrega por CEP retornam `requires_cep` quando recebem apenas um ponto. Quando o catálogo de referência não identifica um nome, a API procura candidatos nos demais catálogos para que a pessoa escolha uma apresentação.

A resposta de preços inclui as modalidades que cada rede confirmou, taxas informadas e identificação e endereço dos pontos de retirada. Uma opção de retirada confirma o atendimento simulado para aquela quantidade. Para repetir o ensaio local de concorrência, rejeição de entradas e persistência de mil produtos, execute `node scripts/stress.mjs` na cópia de desenvolvimento. O ensaio usa o serviço em loopback e um catálogo sintético.

## Funções verificáveis por rede

| Consulta | Drogasil | Pague Menos e Drogaria São Paulo |
|---|---|---|
| Catálogo, SKU, lote de SKUs e GTIN | Sim | Sim |
| Informações por nome ou SKU, sem CEP | Ficha estruturada e fontes regulatórias no MCP específico | Título e campos publicados pela rede |
| Marca e genéricos da mesma apresentação | Comparação no catálogo Drogasil | Equivalência do catálogo de referência e embalagem confirmada na rede |
| Preço e atendimento local | Estoque por filial e preço de referência | Simulação por CEP, SKU, vendedor e quantidade |
| Cesta de vários produtos | Planejamento de paradas e percurso | Simulação conjunta, pontos de retirada comuns e subtotal dos produtos quando confirmado |
| Diretório de lojas | Sim | Os pontos de retirada vêm da cotação |
| Filial fisicamente mais próxima e ampliação para 25 km | Sim | Sem cobertura confirmada para essa operação |
| Snapshot com paginação de leitura | Sim | Sim, com ofertas por SKU |

A CLI, a biblioteca, o HTTP e o MCP compartilham o registro de operações. Os nomes MCP usam o prefixo `pharmacy_`. Para operações em outras redes, escolha o identificador da rede em `pharmacy_retailers`. Os dados de preço e estoque sempre pertencem à rede consultada. A equivalência é limitada aos genéricos que o catálogo de referência consegue identificar e cuja embalagem consta na rede selecionada. Uma classificação, concentração ou retenção ausente fica sem confirmação.

```sh
farmacias product --gtin 7899547543766 --retailer paguemenos
farmacias info Tylenol loratadina --retailer drogariasaopaulo
farmacias compare 3530 --retailer drogariasaopaulo --generics
farmacias basket 3179:1 1633706:2 --retailer paguemenos --cep "$CEP"
farmacias stores --retailer drogasil --limit 5
farmacias snapshot loratadina paracetamol --retailer drogariasaopaulo --max-items 10
farmacias read_snapshot "$RUN_ID" --limit 5
```

O teste de aceitação chama o MCP por stdio contra os catálogos reais, exercita os dois CEPs informados no momento do teste e descarta seu banco temporário de snapshots. Ele valida separadamente o escopo do preço, a quantidade consultada, o vendedor e a opção de retirada comum. Execute `node scripts/check-retailer-workflows.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"` com dois CEPs de teste para as cotações. O número de lojas e os preços variam.

Para verificar também os executáveis dos dois pacotes parceiros publicados no GitHub, execute `node scripts/check-sibling-clis.mjs "$CEP_TESTE_A" "$CEP_TESTE_B"`. O teste cobre busca, sugestões, SKU, informações, código de barras, estoque.
