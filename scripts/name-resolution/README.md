# Medication name decisions in Brazilian Portuguese

This benchmark tests whether a provider can pick a documented candidate, ask for clarification, or report that every candidate conflicts with the request. Each provider sees the same shopper wording, evidence and instructions. Labels, retailer URLs and case identifiers stay outside the request. The benchmark exercises candidate selection only. It does not test search recall, check a store, or enable a provider in the plugin.

The first suite has 32 hand-labeled cases covering misspellings, ambiguous prefixes, similar names and conflicting presentations. A second suite has 16 separately labeled requests and uses titles collected from public listings at Drogasil, Pague Menos and Drogaria São Paulo. Each candidate has its source URL in [the catalog fixtures](catalog-cases.json). Shopping requests in both suites are fictional. Multi-candidate questions run in the original and reversed order. The label is defined before either provider answers.

## Observed results on November 28, 2026

| Provider and suite | Cases correct in every order | Correct requests | Wrong product selections | Cases whose answer changed with order | Median / p95 latency | Input tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAI Decisions, synthetic | 24/32 | 48/61 | 5 | 4 | 300 / 364 ms | 18,475 |
| Jev, synthetic | 30/32 | 57/61 | 4 | 0 | 186 / 223 ms | 34,094 |
| OpenAI Decisions, retailer titles | 14/16 | 29/32 | 0 | 1 | 296 / 540 ms | 13,214 |
| Jev, retailer titles | 15/16 | 31/32 | 1 | 1 | 200 / 313 ms | 22,214 |

The APIs reported 93 decisions each with no transport failures. Using the reported input tokens, the standard-rate estimate per 1,000 requests of the sampled size was **US$0.0341** for OpenAI (`gpt-6-luna`) and **US$0.0254** for Jev (`jev-1.14.0`). Median latency across both suites was 299 ms and 193 ms respectively, measured from the test client. Actual bills can differ. The estimates use US$0.10 and US$0.042 per million input tokens and exclude any account-specific terms. [OpenAI Decisions pricing](https://developers.openai.com/api/docs/guides/decisions) · [Jev pricing](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost)

Both providers picked a wrong candidate five times across the two suites. On real titles OpenAI's three misses asked for clarification when there was no matching candidate. Jev once selected regular 500 mg Novalgina tablets for a request explicitly requiring an effervescent presentation, with no matching effervescent candidate. In the synthetic suite, Jev selected prednisona for an ambiguous prefix shared with prednisolona in both orders. A ranker can propose a clarification. The catalog resolver still needs to enforce brand, ingredient, strength, form, release and pack constraints, distinguish a missing result from an ambiguous one and handle an unavailable provider. These pairs and repeated orders are a small convenience sample.

## Reproduce

With Node 20 or newer, run the following from the repository root. The offline mode constructs all requests without contacting an API.

```sh
node scripts/name-resolution/compare.mjs --provider jev --suite catalog --offline
node scripts/name-resolution/compare.mjs --provider openai --suite fixtures --offline
```

Set the selected provider's temporary credential in the process environment (`OPENAI_API_KEY` or `TYPESAFE_API_KEY`) and omit `--offline` for a paid run. Pass `--model` to select a supported model. The runner emits one JSON line per probe and a final summary. A mismatch or unanswered probe sets exit status 1. No credentials, location or personal history are part of the fixtures.
