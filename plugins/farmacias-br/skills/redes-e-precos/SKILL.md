---
name: redes-e-precos
description: Use para procurar produtos, conferir estoque ou comparar preços entre Drogasil, Pague Menos, Drogaria São Paulo e Farmácias Independente por CEP no Brasil.
---

Para “em qual rede sai mais barato?”, use pharmacy_prices com a apresentação pedida e o CEP compartilhado. Um SKU interno pertence a uma só rede. Informe o identificador dela junto com o SKU. Um GTIN válido identifica o pacote entre redes. Se houver mais de uma concentração, forma, liberação ou tamanho de caixa possível, apresente as opções para a pessoa escolher. Para compras por marca, pergunte uma vez se pode incluir genéricos, exceto quando a preferência já foi informada. Não misture genéricos com ofertas da mesma caixa.

Ordene verifiedOffers por preço e mostre rede, vendedor, preço de venda e condições de retirada ou entrega. Os valores são por embalagem. Separe onlineOffers e use checkedRetailers da mesma resposta para dizer quais redes confirmaram atendimento para o CEP. Descreva no_exact_match como “não encontrei correspondência exata para esta caixa na consulta”. Quando nenhuma confirmar, relate esse resultado e a cobertura consultada. Se o usuário já compartilhou as coordenadas e o serviço precisa do CEP, peça apenas essa informação. Não assuma uma cidade padrão.

Para uma pesquisa de catálogo sem localização, use pharmacy_search. Para um produto de uma rede específica, use pharmacy_product com a rede e o SKU. Para estoque em uma rede específica, use pharmacy_stock. A Drogasil informa unidades por filial. Pague Menos e Drogaria São Paulo confirmam atendimento para a quantidade solicitada. Farmácias Independente pode informar uma faixa de estoque em filiais do município. Preserve as diferenças entre nenhuma filial participante, estoque zero, quantidade desconhecida e falha temporária.

Quando a busca da Pague Menos devolver sugestões, ofereça o primeiro termo (“Você quis dizer morfina?”) ou mostre as alternativas se a pessoa pedir. Aguarde a escolha e consulte pharmacy_search com o termo escolhido e retailer `paguemenos`. Para completar um prefixo explicitamente, use pharmacy_suggest. Para afirmar que um produto contém um princípio ativo, confirme-o no campo activeIngredients.

Para a loja Drogasil mais próxima, listas de compras e perguntas factuais sobre medicamentos, use as instruções de nearby-stock e compare-presentations. Os planos de compra por filial calculados por plan_purchase abrangem a Drogasil. Se uma pesquisa for somente informativa, responda sem CEP e sem pesquisa de preços ou estoque.
