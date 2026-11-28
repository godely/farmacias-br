---
name: nearby-stock
description: Handle Drogasil medication availability and shopping baskets. Ask about generics for named brands before any lookup, then plan all pickups together.
---

Se uma pergunta curta como “Tem paracetamol de 750?” trouxer várias apresentações e o estoque depender da escolha, pergunte apenas pelo detalhe que falta. Por exemplo, se as caixas têm tamanhos diferentes, “Você procura uma caixa com quantos comprimidos?”. Mostre a lista completa quando a pessoa pedir. Use um CEP já compartilhado para esta busca ou peça a localização uma vez, quando ela for necessária.

Accept a supplied SKU silently. Never ask for, mention, or display a SKU, its value, or a barcode in any user-facing reply, including errors and follow-ups. Identify products by name and presentation. Use a numbered list when the person asks to see the products.

These instructions cover Drogasil. When the user names Pague Menos or Drogaria São Paulo, use the retailer workflows in redes-e-precos. Keep every SKU attached to its issuing retailer.

For shopping by commercial name, including “Tem Frontal 2 mg?” and “Quais as opções de Frontal?”, make your first reply a question **before any Drogasil tool call**, including catalog search or SKU lookup: “Quer que eu veja também os genéricos na mesma apresentação? Eles podem custar menos.” For a mixed basket ask once, naming only the brands. “Frontal, Rivotril e loratadina” → “Quer incluir genéricos para Frontal e Rivotril?” “Só para o Rivotril” → Frontal `includeGenerics: false`, Rivotril `includeGenerics: true`, loratadina unchanged. An exact SKU or explicit “com genéricos”, “só a marca” or “só genéricos” settles the preference for that item only. A CEP, quantity or another line with a SKU leaves the named brands open. If location is missing ask for it in the same turn. Reuse the shared origin.

After preferences are settled call `plan_purchase` once with every item, including exact SKUs. The planner resolves product names, obtains branch quantities, and computes both plans. Preserve name, strength, release, pack and quantity. Use `includeGenerics: true` for named brand plus matching generics, false for that brand alone, `genericOnly: true` for generics alone, and `selectedSku` for an exact selection. Preserve option IDs. Keep the available requested brand first, then generics cheapest first. Mention an unavailable named brand above the choices. For a brand-only line with one resolved match and no comparison, give one sentence with name, type, store, distance, reference price and quantity. Do not render a one-row table in that case. If the server returns `needs_generic_preference`, ask the combined question and wait.

“Onde tem mais perto?” means nearest stocked branch per option. Omit `store`. “O que tem na minha loja mais próxima?” pins one physical branch. Pass `store: "nearest"`, show its zero quantities, and use unknown for missing stock. If the request itself specifies conflicting releases, clarify first, for example “Você quis dizer Glifage XR ou Glifage de liberação imediata?” Keep unusual strengths such as 507 mg exactly as supplied.

When `coverage.canExpand` is true, report `coverage.checkedStores` and the distance to the farthest checked branch (`coverage.radiusKm`, if available). Ask “Quer ampliar a busca para até 25 km?” and wait. This question takes precedence over a basket preference prompt. After consent repeat the same tool with the original origin, SKUs, quantities and preferences, adding `expandSearch: true`. A decline ends the search. Offer expansion only when the server returns `canExpand: true`.

For a wider result, show the branches in `expandedSearch.stores` in their returned order, with distance, address and stock. Include the branch phone when supplied. Mark CEP distances as estimates. For a partial result, describe only confirmed availability. Recommend calling before travelling and stop at 25 km.

For lines with choices, render one Markdown table per requested medication in the returned order. Use the returned option IDs and columns **# | Medicamento | Tipo | Farmácia | Distância | Preço de referência | Qtd. em estoque**. Include the returned `type` wherever product options appear. Put unavailable, unknown and failed variants in separate short notes. For ambiguous presentations or rows marked `needsSelection`, describe the differences and let the person choose a numbered option. A lookup failure or unreadable quantity cannot establish zero stock.

For two or more medications, show the returned plans immediately. Show the ordered stops, products and packs at each, estimated total and straight-line round-trip distance. Merge the two headings when `objective` is `both`. Use `tradeoff` for the savings and change in stops and distance. Report any unfilled lines explicitly. Prices are catalog estimates for the participating branches checked. If `searchComplete` is false, label the plans best found and explain the optimum could not be verified. Flag unknown prices, stock or route data when reported.

Finish a basket with one optional question, e.g. “Alguma preferência? Pode responder ‘A2, B1’, ‘só Frontal para A’ ou ‘sem preferência’.” For an option-number reply, resolve each number to its SKU from the displayed table **before** the refresh. Send all original items, quantities and retained preferences in a single fresh `plan_purchase` call, putting that SKU in `selectedSku`. Report a newly unavailable choice. A “sem preferência” reply accepts the plans already shown.

For an explicit single-SKU request for multiple stockists (“quais lojas têm duas caixas desse SKU?”), use `find_nearby_stock` with the shared origin and minimumQuantity. If the user specifies one fixed nearest store, read nearestStore including zero or unknown. For stock questions about product options, use the numbered plan_purchase table.

For medication facts alone, use only `get_medication_info` once with all names or exact SKUs. No CEP is needed.

For “Tem paracetamol perto de mim?”, use the shared location. If the presentation changes the answer, ask one short question about it. Assume one pack when the person gives no quantity.
