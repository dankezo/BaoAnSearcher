# VSS free relay verification — 2026-10-06

Implemented a fixed-source authenticated export relay, a bounded GitHub client, and the existing VSS parser/TiDB upsert integration. No new project dependencies, browser runtime, AI calls, source cookies, payment method, or TiDB credentials at either relay.

## Deployed environments

| Environment | Health / authentication | Real VSS export |
| --- | --- | --- |
| Render Free, Singapore: `https://baoan-vss-relay.onrender.com` | Health 200 with expected service JSON; export without key 401 | 02/10/2026 and 05/10/2026 fail after two attempts; direct authenticated export returns 502 `source_export_unavailable` (10.7 s sample) |
| Deno Free: `https://lively-starfish-9661.dannyphan190.deno.net` | Health 200 with expected service JSON; export without key 401 | 02/10/2026 and 05/10/2026 fail after two attempts (19.62 s / 16.52 s total); direct authenticated export returns 502 (5.8 s sample) |

Local Python relay code, using verified TLS and no cookies, successfully downloaded 02/10/2026: 464,904 bytes, valid SpreadsheetML Workbook, 219 parsed rows, 3.62 seconds. This proves the source/export/parser work locally; it does not prove cloud connectivity. The relay deliberately returns generic failures; the exact upstream failure class and cause are not established.

## GitHub verification

- Implementation branch: `codex/vss-free-relay`.
- Render run: https://github.com/dankezo/BaoAnSearcher/actions/runs/37427635790 — VSS failed, exit 1.
- Deno run: https://github.com/dankezo/BaoAnSearcher/actions/runs/37428592754 — VSS failed, exit 1.
- Both used `only=vss`, five replay days and Ubuntu. No failed export was uploaded or marked complete.
- TiDB after the probes: 744,781 existing VSS rows; `data_registry_meta.VSS.last_synced_at` remains `2026-10-01 10:02:17`, status `warning`.
- `VSS_EXPORT_RELAY_URL` (currently Deno) and `VSS_EXPORT_RELAY_KEY` are saved in GitHub Secrets; the relay invocation key is saved at Render/Deno. The temporary local key file was removed. No keys are in source control.

## Limits and activation gate

The private endpoint accepts only `{date, loai}`, fixes the VSS source URL, verifies TLS, rejects redirects, limits files to 10 MB, and limits dates to the last 30 days. The client validates complete SpreadsheetML XML, wakes the relay for at most 90 seconds, and tries each export at most twice. Python uses connect/read timeouts and an elapsed stream guard; Deno uses a 30-second AbortSignal.

The existing 05:17 Vietnam GitHub schedule remains **tenders,prices only**. VSS is **not enabled**. The default branch was not changed; the relay integration is available locally and on the test branch. Local schedule controls and online-to-local pull remain unchanged.

Because neither relay returned a valid source workbook, cloud row comparison, duplicate upsert verification, and wake-from-idle verification did not pass and were not claimed. Do not enable VSS until these checks and a complete GitHub-to-TiDB run succeed. No paid fallback was selected.

## Validation and source references

`python -m unittest tests.test_vss_relay tests.test_cloud_crawl -q`: 16 tests passed, including authentication, fixed URL/TLS, size limits, HTML/malformed XML rejection, bounded retry and no success metadata on failed export. A Node VM check of the Deno handler also passed authentication, invalid payload/date/type rejection, fixed URL and valid export response.

Render limits: https://render.com/docs/free ; Singapore region: https://render.com/docs/regions . Deno pricing: https://deno.com/deploy/pricing . The Deno console reports this organization is not verified; no payment-based verification or upgrade was performed.