# Zendesk MCP — Config-Write Tool Expansion — Test Report

**Date:** 2026-07-29
**MCP:** `zendesk-mcp-http` (broker-first, per-connection OAuth)
**Request:** `zendesk-mcp-tool-request.md` (Bastion CS SOW)
**Production writes performed:** **NONE.** No object was created/updated/deleted in
`bastionsupport.zendesk.com`. All validation was mocked-HTTP (option (b)). The
Ultimate.ai trigger and every existing object were untouched — never referenced by a call.

---

## ✅ STATUS: SHIPPED & LIVE (2026-07-29)

- **Deployed:** `zendeskmcp.agenticledger.ai` — `/health` reports **v2.0.0, 101 tools,
  brokerConfigured:true**. Commit `79bcb9b` on `main`; Railway auto-deployed.
- **MCP endpoint:** `https://zendeskmcp.agenticledger.ai/mcp` (streamable-http).
- **All 49 new tools are live** on the same broker OAuth path as the existing 52.

### 👉 For the CONNECTED agent — please run the live READ test

I could not run the live reads myself: the connection isn't under the `default`
principal, and the broker won't enumerate an unknown one. You (already connected) can
prove the new endpoints end-to-end with **GET-only** calls — no writes:

- Simplest: call these live tools and confirm they return data —
  `trigger_categories_list`, `schedule_list`, `custom_status_list`, `sla_policy_get`
  (id from `sla_policies_list`), `trigger_get`, `ticket_field_get`, and
  `zendesk_api_request {method:"GET", path:"/api/v2/ticket_forms"}`.
- Also confirm the safety gate: `zendesk_api_request {method:"POST", path:"/api/v2/groups",
  body:{...}}` **without** `allow_writes` must return `{refused:true}` and make **no** call.
- Repo script (if running locally with the broker install `.env`):
  `ZTEST_PRINCIPAL=<your instanceId:agentId> npx tsx test/read-smoke.ts` — GET-only.

**First live config WRITE** is the real scope check: if a curated create 403s, the OAuth
connection was authorized read-only → re-connect requesting `read write hc:write` (see §a).
All production writes remain the delivery agent's job under change-control — not done here.

---

## (a) OAuth scopes — re-auth likely required

The MCP holds **zero secrets**; the token lives in the Connections Broker and is injected
per request, so I cannot introspect the granted scopes from here without a live call
(deliberately not made). What the SOW build needs:

- **`write`** — required for every P0/P1 config write (fields, forms, groups, SLAs,
  triggers, automations, schedules, statuses, macros, views). Zendesk OAuth scopes are
  coarse: a single `write` grant covers all of these.
- **`hc:write`** (Help Center) — required for `hc_*_create/update/delete`. Separate scope.

**Action for the delivery agent:** on the first live config write, if you get **403** with
the curated tool (see below — 403s are surfaced verbatim), the connection was authorized
read-only. Re-connect through the broker consent flow requesting **`read write hc:write`**.
This is a re-auth, not a code change. A cheap live probe once connected: `zendesk_api_request
{method:"GET", path:"/api/v2/ticket_fields"}` succeeds on read; the first curated create that
403s confirms the scope gap.

## (b) Tools ready vs blocked

**All requested tools are built and unit-validated. None are blocked in code.** The only
runtime gate is the OAuth scope above (external to this MCP).

| Priority | Delivered tools |
|---|---|
| ⭐ Unblock | `zendesk_api_request` (read-safe; write verbs gated) |
| P0 | `ticket_field_{get,create,update,delete}` |
| P0 | `ticket_form_{get,create,update,delete}` |
| P0 | `group_{create,update,delete}`, `group_membership_{create,delete}` |
| P0 | `sla_policy_{get,create,update,delete}` |
| P0 | `trigger_{get,create,update,delete}`, `trigger_categories_list`, `trigger_category_create` |
| P0 | `automation_{get,create,update,delete}` |
| P0 | `schedule_{list,get,create,update}` |
| P1 | `custom_status_{list,create,update}` |
| P1 | `macro_{get,create,update,delete}` |
| P1 | `hc_category_{create,update}`, `hc_section_{create,update}`, `hc_article_{create,update,delete}` |
| P2 | `view_{create,update,delete}` |

Tool count: **52 → 101** (49 new). `tsc` build clean; no duplicate tool names.

## (c) Passthrough exists and is read-safe

`zendesk_api_request(method, path, query?, body?, allow_writes?)`:
- **GET always allowed.**
- **POST/PUT/DELETE/PATCH refused** with `{refused:true, reason:...}` and **no HTTP call
  is made** unless `allow_writes:true` is explicitly passed (Safety rule #4).
- Signs with the same broker OAuth token as every other tool; `path` accepts `/api/v2/...`,
  `ticket_fields/123`, or a full URL (all normalise to the caller's Zendesk host).

## (d) Test evidence

`test/mock-test.ts` — `global.fetch` replaced by a recorder returning canned 200s; **no
socket ever opened to Zendesk**. For each new tool it (1) validates args against the tool's
zod `inputSchema` exactly as the server would, then (2) runs the handler and asserts HTTP
method + `/api/v2/...` path + JSON body envelope (`{ticket_field:…}`, `{sla_policy:…}`, etc.)
+ `Authorization: Bearer <token>`.

```
220 assertions passed, 0 failed.
✓ All new config-write tools validated against mocked HTTP. No live calls made.
```

Explicitly verified:
- Passthrough refuses POST/DELETE without `allow_writes` and makes **no** call; allows GET;
  performs POST when `allow_writes:true`.
- HC writes put **locale in the path** (`/help_center/en-us/categories/{id}/sections`) and
  `hc_article_create` requires **`permission_group_id`** + accepts **`user_segment_id`**
  (null = everyone) — the Guide create quirk from the request.
- `group_membership_create` wraps `{user_id, group_id}` in `{group_membership:…}`.

Run it: `npx tsx test/mock-test.ts`

## 403 vs 400

The client throws `Zendesk API <status>: <body>` verbatim (`api-client.ts` `request()`), so a
scope failure surfaces as `Error: Zendesk API 403: …` and a bad payload as `Error: Zendesk API
400: …` — distinct, as required. No status collapsing.

## Not done (by design)
- No live create→verify→delete against a sandbox: no dev instance is wired here, so I used
  mocked-HTTP (option (b)) per the request's accepted approaches. If you want (a), point me at
  a sandbox subdomain + a broker connection for it and I'll run a real round-trip there — never
  against production.
- ~~Not yet deployed.~~ **Deployed 2026-07-29** (commit `79bcb9b`, v2.0.0, live at
  `zendeskmcp.agenticledger.ai`). No new env needed — reused the original broker install vars.
