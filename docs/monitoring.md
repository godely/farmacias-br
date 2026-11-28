# Reviewing lookup failures in Sentry

Set `FARMACIAS_SENTRY_DSN` in the server environment to the project’s public client DSN. The hosted MCP and REST handlers share an observer. Portable clients have monitoring disabled by default. There are no end-user identifiers. The ingestion address belongs in the operator's configuration.

## Reviewing a batch

In **Issues**, filter by the Farmácias BR project and sort by frequency over the last seven days. Each issue groups an operation, retailer, outcome and set of presentation constraints. Inspect its first and last occurrence and affected releases. A single basket can contain a successful line and a failed one. Each requested item is counted individually. A price comparison contributes one observation per checked retailer. A stock request that also returns branch inventory records the inventory under its own operation, `branch_inventory`. For named baskets, both REST and MCP use `plan_purchase`. Pickup checks used to build an itinerary also report incidents under `pickup_quote`, including when a different chain fills the entire basket. Filter on the retailer to find the affected source. Several failed attempts for the same combination of items at that retailer count once per request. A joint check has the shape `joint`. These incident counts measure affected subsets and have no success denominator of their own.

In **Explore → Metrics**, select `farmacias.lookup.outcomes` and sum the counter, grouping by `outcome`. To compare releases, divide the sum of `lookup_miss` by the sum for all outcomes under the same operation, retailer and query shape. A miss is a candidate for investigation. A genuine catalog absence can produce the same signal. Confirm the pattern with public catalog examples, then add a regression before changing the matcher.

| Outcome | Meaning |
|---|---|
| lookup_miss | No matching catalog entry or exact pack, or an unknown SKU. |
| catalog_incomplete | Details needed for equivalence or price are missing. |
| upstream_failure, handler_exception, timeout | A source reported failure, a handler threw, or a timed operation expired. |
| stock_unknown | A stock check left availability unresolved. |
| pickup_unconfirmed | The checkout left a pickup check unresolved. A source error with explicit evidence is grouped as upstream_failure. |
| fulfillment_unavailable | Checkout offered no fulfillment for the request. Counted as an ordinary outcome. |
| no_qualifying_stock | No checked branch met the requested minimum. The result leaves the exact balance unresolved. |
| zero_stock, insufficient_stock, unavailable, outside_coverage, clarification, ok | Expected outcomes included in the denominator. These do not create issues. |
| canary_mismatch, service_exit | A synthetic catalog check failed or the service terminated abnormally. |

Only enumerated dimensions, application version, counters, timestamps and generated event IDs leave the service. For example a query can be classified as `name.strength.form.release.pack`. Drug names, SKUs, quantities, query text, CEPs, coordinates, IPs of callers, request bodies, headers, exception messages and raw stack traces are excluded from the event. Each issue is also written to the service journal with the same safe dimensions. The transport enforces a bounded in-flight queue and respects Sentry rate limits. Lost deliveries are counted in the journal. Sentry outages, process loss and account quotas can reduce online counts.

Run `node scripts/check-presentations.mjs` on the deployment host to verify known conventional/extended presentations, drops and an intentionally mismatched bottle volume. The synthetic checks use a separate stdio instance so that deliberate misses stay out of real traffic metrics. A user systemd timer can run it daily with the same private environment file. Configure `ExecStopPost` to run `scripts/report-service-exit.mjs` with Node if the service manager should report failed exits. A complete host or network outage needs an independent uptime monitor.

The integration covers server-visible outcomes. A client can still phrase a correct result incorrectly or present a plausible wrong product that passes every check. Real-client replays and comparisons against known public products cover different failures.
