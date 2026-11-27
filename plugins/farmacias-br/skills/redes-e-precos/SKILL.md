---
name: redes-e-precos
description: Use para buscar nomes completos, incompletos ou com erros de digitação na Pague Menos, Drogaria São Paulo e Farmácias Independente, responder a confirmações de nomes e consultar produtos, preços e estoque de quatro redes brasileiras.
---

Para “em qual rede sai mais barato?”, use pharmacy_prices com a apresentação pedida e o CEP compartilhado. Um SKU interno pertence a uma só rede. Informe o identificador dela junto com o SKU. Um GTIN válido identifica o pacote entre redes. Se houver mais de uma concentração, forma, liberação ou tamanho de caixa possível, apresente as opções para a pessoa escolher. Para compras por marca, pergunte uma vez se pode incluir genéricos, exceto quando a preferência já foi informada. Não misture genéricos com ofertas da mesma caixa.

Ordene verifiedOffers por preço e mostre rede, vendedor, preço de venda e condições de retirada ou entrega. Os valores são por embalagem. Separe onlineOffers e use checkedRetailers da mesma resposta para dizer quais redes confirmaram atendimento para o CEP. Descreva no_exact_match como “não encontrei correspondência exata para esta caixa na consulta”. Quando nenhuma confirmar, relate esse resultado e a cobertura consultada. Se o usuário já compartilhou as coordenadas e o serviço precisa do CEP, peça apenas essa informação. Não assuma uma cidade padrão.

Para uma pesquisa de catálogo sem localização, use pharmacy_search. Para um produto de uma rede específica, use pharmacy_product com a rede e o SKU. Para estoque em uma rede específica, use pharmacy_stock. A Drogasil informa unidades por filial. Pague Menos e Drogaria São Paulo confirmam atendimento para a quantidade solicitada. Farmácias Independente pode informar uma faixa de estoque em filiais do município. Preserve as diferenças entre nenhuma filial participante, estoque zero, quantidade desconhecida e falha temporária.

Na Pague Menos, Drogaria São Paulo e Farmácias Independente, indique a rede solicitada em todas as chamadas. Envie à `pharmacy_search` exatamente o texto digitado, inclusive se parecer incompleto ou errado. Se vier `confirmation`, a primeira resposta ao usuário é somente a pergunta de `confirmation.question` (por exemplo, “Você quis dizer loratadina?”). Aguarde a resposta no chat. Faça isso para qualquer nome. A pessoa já sabe a qual proposta está respondendo.

- “Sim”, “isso” ou “pode” confirma o termo. Chame `pharmacy_search` uma vez com `confirmation.onYes` e apresente os produtos retornados.
- “Não” pede as outras sugestões. Chame `pharmacy_suggest` com `confirmation.onNo`, mostre as alternativas retornadas como termos de busca; quando forem concentrações do mesmo princípio ativo, identifique-as como refinamentos da busca. Apresente as opções e aguarde a escolha. Se estiverem vazias, peça outra grafia ou o nome da embalagem.
- Uma escolha explícita vai direto para `pharmacy_search` na mesma rede. Se a pessoa pedir todas as sugestões desde o início, use `pharmacy_suggest` com `listAll: true`.

Para afirmar que um produto contém um princípio ativo, confirme-o em `activeIngredients`. Quando a evidência for `matched_gtin`, a ficha da outra rede confirmou a composição pelo mesmo código de barras. Mostre o produto e o SKU da rede solicitada. Uma falha da fonte deve ser comunicada como falha da consulta.

Para a loja Drogasil mais próxima, listas de compras e perguntas factuais sobre medicamentos, use as instruções de nearby-stock e compare-presentations. Os planos de compra por filial calculados por plan_purchase abrangem a Drogasil. Se uma pesquisa for somente informativa, responda sem CEP e sem pesquisa de preços ou estoque.
