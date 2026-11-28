---
name: compare-presentations
description: Answer Drogasil medication facts and prescription questions, including strengths, drops and sublingual forms, or compare presentations and catalog prices.
---

Para “onde eu acho perto de mim?” ou “pode ser em qualquer uma”, consulte as três redes em uma chamada a `plan_purchase`, omitindo `retailer` e `retailers`. Use `retailer` apenas para uma rede escolhida pela pessoa, ou `retailers` para um grupo escolhido. Preserve essa escolha quando a pessoa esclarecer o tamanho da caixa, a dose ou a forma. Consultar um catálogo para esclarecer a apresentação não restringe a busca. Se crossRetailerPlans tiver uma cesta completa, comece dizendo onde pegar cada medicamento. Uma lista vazia em completeRetailers significa que nenhuma rede resolveu tudo sozinha. Quando os planos diferirem, mostre quanto se economiza e quantas paradas a mais são necessárias. Use os preços dos produtos e a evidência de estoque ou retirada de cada filial.

Quando a pessoa responder “A de 20. Qual sai mais em conta?”, complete o nome, a dose e a embalagem do mesmo item e consulte as alternativas em uma só chamada. Comece pela caixa de menor preço com estoque ou retirada confirmada para a quantidade pedida. Trate fabricantes como opções para uma compra. Se uma opção tiver estoque, encerre a busca local. A ampliação para 25 km depende de zero em todas as opções aceitas da consulta inteira e de autorização da pessoa.

Se uma pergunta curta como “Tem paracetamol de 750?” trouxer várias apresentações e o estoque depender da escolha, pergunte apenas pelo detalhe que falta. Por exemplo, se as caixas têm tamanhos diferentes, “Você procura uma caixa com quantos comprimidos?”. Mostre a lista completa quando a pessoa pedir. Use um CEP já compartilhado para esta busca ou peça a localização uma vez, quando ela for necessária.

Accept a supplied SKU silently. Never ask for, mention, or display a SKU, its value, or a barcode in any user-facing reply, including errors and follow-ups. Identify products by name and presentation. Use a numbered list when the person asks to see the products.

These instructions cover Drogasil. When the user names Pague Menos or Drogaria São Paulo, use the retailer workflows in redes-e-precos. Keep every SKU attached to its issuing retailer.

For factual medication questions (forms, strengths, ingredients, routes, release, pack or prescription), call only `get_medication_info` once with all medications. Pass the bare SKU if supplied. A brand lookup covers all its forms, including drops. Answer directly from the returned records and sources. Skip catalog searches, SKU lookups and stock tools even if the question mentions a brand or “na Drogasil”. Use `scope: "brazil"` for “em que formas existe?” and `"catalog"` for Drogasil listings. No CEP, prices, stock, or generic question. Cite the returned sources. List strengths paired with each form, preserving mg/mL. Distinguish catalog entries from nationally verified presentations. For prescriptions, answer required, retention and exact form independently. Say “não confirmado” for missing facts.

For price-only requests, settle any named brand preference first. Call `compare_products` without an origin and pass the per-brand `includeGenerics` choice. For equivalence-only questions use `compare_products` without an origin. Keep different strengths, release types and packs separate. Describe catalog matching and reference prices. For an incomplete_presentation, report the direct hits and missing fields. Clarify a no_reference or ambiguous result before changing the presentation. A repeated exact SKU cannot supply missing catalog fields.

For a purchase or stock request with branded items, first ask which brands may include generics and wait for the reply before calling Drogasil. Once settled, send the entire basket, including exact SKUs, to `plan_purchase` together.
