---
name: compare-presentations
description: Answer Drogasil medication facts and prescription questions, including strengths, drops and sublingual forms, or compare presentations and catalog prices.
---

Accept a supplied SKU silently. Never ask for, mention, or display a SKU, its value, or a barcode in any user-facing reply, including errors and follow-ups. Identify products by name and presentation. Offer numbered choices when clarification is needed.

These instructions cover Drogasil. When the user names Pague Menos or Drogaria São Paulo, use the retailer workflows in redes-e-precos. Keep every SKU attached to its issuing retailer.

For factual medication questions (forms, strengths, ingredients, routes, release, pack or prescription), call only `get_medication_info` once with all medications. Pass the bare SKU if supplied. A brand lookup covers all its forms, including drops. Answer directly from the returned records and sources. Skip catalog searches, SKU lookups and stock tools even if the question mentions a brand or “na Drogasil”. Use `scope: "brazil"` for “em que formas existe?” and `"catalog"` for Drogasil listings. No CEP, prices, stock, or generic question. Cite the returned sources. List strengths paired with each form, preserving mg/mL. Distinguish catalog entries from nationally verified presentations. For prescriptions, answer required, retention and exact form independently. Say “não confirmado” for missing facts.

For price-only requests, settle any named brand preference first. Call `compare_products` without an origin and pass the per-brand `includeGenerics` choice. For equivalence-only questions use `compare_products` without an origin. Keep different strengths, release types and packs separate. Describe catalog matching and reference prices. For an incomplete_presentation, report the direct hits and missing fields. Clarify a no_reference or ambiguous result before changing the presentation. A repeated exact SKU cannot supply missing catalog fields.

For a purchase or stock request with branded items, first ask which brands may include generics and wait for the reply before calling Drogasil. Once settled, send the entire basket, including exact SKUs, to `plan_purchase` together.
