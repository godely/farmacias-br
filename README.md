# Farmácias BR

Uma API independente para consultar Drogasil, Pague Menos, Drogaria São Paulo e Farmácias Independente. A mesma consulta pode ser feita pelo terminal, por HTTP e por clientes MCP. O CEP vem de quem consulta. Cada rede confirma a disponibilidade na área que atende.

## Instalar e consultar

Em uma cópia deste repositório, execute `npm ci` com Node.js 20 ou superior. Use `node bin/farmacias.js` ou instale o pacote com `npm install -g .` para usar o comando `farmacias`. Python 3 e curl são usados para snapshots e páginas de oferta da Drogasil.

```sh
farmacias retailers
farmacias search dipirona --limit 3
farmacias product 81128 --retailer drogasil
farmacias stock 81128 --retailer drogasil --cep "$CEP"
farmacias prices 81128 --retailer drogasil --cep "$CEP"
```

Cada SKU pertence a uma rede. A comparação entre redes valida o código de barras e a apresentação antes de ordenar as ofertas pelo preço. O resultado separa valores verificados para o CEP de ofertas de vitrine. Frete e descontos de programas pessoais podem alterar o total. A busca no catálogo e a consulta de informações de um produto funcionam sem CEP.

| Rede | Evidência de disponibilidade |
|---|---|
| Drogasil | Quantidade reportada por filial, distância e alcance da busca. O preço de catálogo é de referência. |
| Pague Menos e Drogaria São Paulo | Simulação de atendimento do CEP por SKU e vendedor, com entrega ou retirada quando informada. A quantidade consultada é o pedido simulado. |
| Farmácias Independente | Faixa de estoque das filiais no município atendido. O preço exibido é o da loja online. |

## Biblioteca, HTTP e MCP

```js
import { searchCatalog, comparePrices } from 'farmacias-br';
const catalog = await searchCatalog({ query: 'dipirona', limit: 3 });
const prices = await comparePrices({ query: '81128', retailer: 'drogasil', zipcode: process.env.CEP });
```

`farmacias-mcp` usa stdio. `farmacias-mcp --http --port 8787` inicia um serviço em 127.0.0.1 com MCP em `/mcp`. A interface HTTP oferece `GET /api/v1/retailers` e `POST /api/v1/{search,product,stock,prices}` com os mesmos parâmetros JSON da biblioteca. Ao usar acesso remoto, proteja o serviço com a autenticação do seu proxy. As operações de consulta não fazem compras.

Os MCPs `pharmacy_search`, `pharmacy_product`, `pharmacy_stock` e `pharmacy_prices` atendem as quatro redes. As ferramentas de informações sobre medicamentos, comparação de genéricos, compra em várias filiais e snapshots da Drogasil também estão disponíveis. O plano de retirada da Drogasil cobre somente suas filiais.

Os quatro adaptadores são projetos independentes. [Drogasil](https://github.com/godely/drogasil-cli) · [Pague Menos](https://github.com/godely/paguemenos-cli) · [Drogaria São Paulo](https://github.com/godely/drogariasaopaulo-cli) · [Farmácias Independente](https://github.com/godely/farmaciaindependente-cli).

## Verificação

Execute `npm test` para testar contratos, falhas parciais, entradas inválidas, leituras concorrentes e os transportes stdio e HTTP. A auditoria com consultas reais aceita um TSV local com UF, município e CEP e um SKU da Drogasil. Cada linha de saída contém o estado, município e resultados das redes. Exemplo de chamada: `node scripts/regional-audit.mjs origens.tsv 81128`. Nenhum CEP é configurado como padrão.
