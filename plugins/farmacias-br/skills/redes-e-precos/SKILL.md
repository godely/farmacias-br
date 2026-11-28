---
name: redes-e-precos
description: Use para buscar nomes completos, incompletos ou com erros de digitação na Pague Menos e na Drogaria São Paulo, responder a confirmações de nomes e consultar produtos, preços e estoque de três redes brasileiras.
---

Aceite em silêncio o SKU ou código de barras que a pessoa fornecer. Nunca peça, mencione nem exiba esses identificadores ou seus valores na conversa, inclusive em erros, tabelas e confirmações. Apresente o medicamento pelo nome. Quando precisar distinguir opções, use a dose, a forma ou o tamanho da embalagem e numere as opções.

Para “em qual rede sai mais barato?”, use pharmacy_prices com a apresentação pedida e o CEP compartilhado. Um SKU interno pertence a uma só rede. Envie a rede de origem junto com o código nos argumentos internos da ferramenta. Um GTIN válido identifica o pacote entre redes. Se houver mais de uma concentração, forma, liberação ou tamanho de caixa possível, apresente as opções para a pessoa escolher. Para compras por marca, pergunte uma vez se pode incluir genéricos, exceto quando a preferência já foi informada. Não misture genéricos com ofertas da mesma caixa.

Ordene verifiedOffers por preço e mostre rede, vendedor, preço de venda e condições de retirada ou entrega. Os valores são por embalagem. Separe onlineOffers e use checkedRetailers da mesma resposta para dizer quais redes confirmaram atendimento para o CEP. Descreva no_exact_match como “não encontrei correspondência exata para esta caixa na consulta”. Quando nenhuma confirmar, relate esse resultado e a cobertura consultada. Se o usuário já compartilhou as coordenadas e o serviço precisa do CEP, peça apenas essa informação. Não assuma uma cidade padrão.

Para uma pesquisa de catálogo sem localização, use pharmacy_search. Para um produto de uma rede específica, use pharmacy_product com a rede e o SKU. Para estoque em uma rede específica, use pharmacy_stock. A Drogasil informa unidades por filial. Pague Menos e Drogaria São Paulo confirmam atendimento para a quantidade solicitada. Preserve as diferenças entre nenhuma filial participante, estoque zero, quantidade desconhecida e falha temporária.

Na Pague Menos e na Drogaria São Paulo, indique a rede solicitada em todas as chamadas. Envie à `pharmacy_search` exatamente o texto digitado, inclusive se parecer incompleto ou errado. Se vier `confirmation`, a primeira resposta ao usuário é somente a pergunta de `confirmation.question` (por exemplo, “Você quis dizer loratadina?”). Aguarde a resposta no chat. Faça isso para qualquer nome. A pessoa já sabe a qual proposta está respondendo.

- “Sim”, “isso” ou “pode” confirma o termo. Chame `pharmacy_search` uma vez com `confirmation.onYes` e apresente os produtos retornados.
- “Não” pede as outras sugestões. Chame `pharmacy_suggest` com `confirmation.onNo`, mostre as alternativas retornadas como termos de busca; quando forem concentrações do mesmo princípio ativo, identifique-as como refinamentos da busca. Apresente as opções e aguarde a escolha. Se estiverem vazias, peça outra grafia ou o nome da embalagem.
- Uma escolha explícita vai direto para `pharmacy_search` na mesma rede. Se a pessoa pedir todas as sugestões desde o início, use `pharmacy_suggest` com `listAll: true`.

Para afirmar que um produto contém um princípio ativo, confirme-o em `activeIngredients`. Quando a evidência for `matched_gtin`, a ficha da outra rede confirmou a composição pelo mesmo código de barras. Mostre o nome e a apresentação do produto na rede solicitada. Uma falha da fonte deve ser comunicada como falha da consulta.

Para informações sobre apresentações em uma rede específica, chame `pharmacy_info` com a rede e todos os nomes ou SKUs na mesma consulta, sem pedir CEP. Relate a concentração com a apresentação correspondente. Use os rótulos explícitos de prescrição e retenção individualmente. Quando faltar evidência, diga “não confirmado”. Para informações regulatórias nacionais use `get_medication_info` com o nome e o escopo nacional. SKUs são exclusivos de cada rede.

Se a pessoa quiser comparar a marca com genéricos na mesma rede, confirme a preferência e use `pharmacy_compare`. Havendo várias apresentações, peça a escolha e prossiga com o SKU local. Mostre a marca solicitada primeiro e depois as opções verificadas em ordem de preço. Informe se alguma apresentação ficou sem confirmação. Para procurar uma embalagem pelo código de barras, use `pharmacy_product` com `gtin`. Para vários códigos internos da mesma rede, envie `skus` numa chamada.

Para conferir uma cesta na Pague Menos ou na Drogaria São Paulo, envie os SKUs escolhidos e suas quantidades em uma única chamada a `pharmacy_basket`. Quando houver mais de um vendedor, confirme a escolha. Informe um ponto de retirada para a cesta inteira somente se vier em `commonPickupPoints`. O total dos produtos exclui frete. Para a filial fisicamente mais próxima e planejamento de roteiro da Drogasil, siga nearby-stock.


Quando a pessoa restringir a busca ou o preço a certas redes, envie exatamente esses IDs em `retailers` para `pharmacy_search` ou `pharmacy_prices`. Em preços, `retailer` informa somente a origem de um SKU local. Para comparar cestas, confirme as apresentações e use `pharmacy_baskets` uma vez com todos os GTINs, quantidades, CEP e redes escolhidas. Mostre os subtotais de cestas completas confirmadas para o CEP, as estimativas de referência da Drogasil e as redes com itens pendentes. Informe que os subtotais excluem frete.

Para localizar filiais, consulte `pharmacy_stores`. Pague Menos precisa de um CEP ou coordenadas. O diretório da Drogaria São Paulo é nacional. Em `pharmacy_stock`, as três redes aceitam coordenadas. Uma filial no diretório e uma quantidade solicitada na simulação não comprovam unidades na prateleira.

Para comparar as apresentações de uma rede com retirada ou entrega, envie o CEP ou as coordenadas compartilhadas na própria chamada a `pharmacy_compare`. Mostre a disponibilidade informada para cada opção. `closestQuotedPickup` identifica o ponto de retirada mais próximo entre as ofertas com distâncias conhecidas. Se o campo vier vazio, apresente os pontos sem classificá-los por distância. Ao mostrar um frete, identifique se o valor foi confirmado para a cesta inteira ou apenas distribuído entre os itens.

Para uma cesta de medicamentos identificados por nome em uma só rede, resolva a preferência de genéricos das marcas e chame `plan_purchase` uma vez com `retailer`, todos os itens e a origem compartilhada. Para `choose_products`, apresente as opções por item e mantenha a seleção ligada ao SKU no retorno. Nos parceiros, os pontos de retirada em comum vêm da simulação conjunta. Uma contagem exata de unidades ou um roteiro ótimo entre filiais continua sem confirmação.

Para “Tem paracetamol perto de mim?”, use a localização já compartilhada. Se a apresentação mudar a resposta, faça uma pergunta curta sobre ela. Considere uma caixa quando a pessoa não disser quantas precisa.
