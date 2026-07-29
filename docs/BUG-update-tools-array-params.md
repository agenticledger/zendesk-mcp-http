# BUG: Curated `*_update` tools drop ARRAY params (`actions`, etc.) — same root cause as the hash-param bug, on the update path

**Component:** `zendesk-mcp-http` — MCP tool layer (`src/tools.ts`)
**Severity:** High — `trigger_update` is effectively unusable (Zendesk requires `actions` on a trigger
update, and the tool can't send them). Blocks the *modify* half of routing/escalation/SLA buildout
(D2/D7 of the Bastion CS SOW). Same failure class likely affects `automation_update`, `view_update`,
`macro_update`, and any `*_update` with an array-valued param.
**Status:** ✅ **RESOLVED** — fixed in `v2.0.2` (commit `5c78546`, live at `zendeskmcp.agenticledger.ai`,
2026-07-29). Root cause confirmed exactly as diagnosed. This is the **sibling** of the already-fixed
`BUG-hash-param-serialization.md` (v2.0.1): that fix coerced **object** params on update handlers but
**not array** params — v2.0.2 adds the array keys to each `*_update` handler's `coerce()` list.

### Fix applied — exact changes (v2.0.2)

`asObject()` already parses a JSON string to either an object OR an array, so the fix is purely adding the
array (and any missing structured) keys to each `.passthrough()` `*_update` handler in `src/tools.ts`. Full
audit done — every `*_update` cross-checked against its `*_create` typed params:

| Update tool | v2.0.1 | v2.0.2 (now) |
|---|---|---|
| `trigger_update` | `coerce(rest,'conditions')` | `coerce(rest,'conditions','actions')` |
| `automation_update` | `coerce(rest,'conditions')` | `coerce(rest,'conditions','actions')` |
| `sla_policy_update` | `coerce(rest,'filter')` | `coerce(rest,'filter','policy_metrics')` |
| `macro_update` | *(none)* | `coerce(rest,'actions','restriction')` |
| `ticket_field_update` | *(none)* | `coerce(rest,'custom_field_options')` |
| `ticket_form_update` | *(none)* | `coerce(rest,'ticket_field_ids')` |
| `schedule_update` | *(none)* | `coerce(rest,'intervals')` |
| `view_update` | `coerce(rest,'conditions','execution','restriction')` | unchanged (no array param) |

**Confirmed safe without coercion** (so not touched): `tickets_update` / `users_update` /
`organizations_update` use **typed** schemas (their arrays are `z.array(...)` → host passes real arrays);
`group_update` / `custom_status_update` / `hc_category_update` / `hc_section_update` / `hc_article_update`
have only scalar params.

**Tests:** 8 new mocked-HTTP assertions verify stringified `actions` / `policy_metrics` /
`custom_field_options` / `ticket_field_ids` / `intervals` arrive as **arrays**, and a real array still passes
through. Full suite **235/235 pass**, zero live calls. Version bumped `2.0.1 → 2.0.2`.

**Please re-run the Verification plan below live** — `*_update` with an `actions` array should now 200.
Original diagnosis/repro preserved below for the record.
**Not the cause:** OAuth scope, Zendesk permissions, the broker, the gateway, or the API client — all
independently proven working (the passthrough workaround below returns HTTP 200 with identical data).

---

## TL;DR

The v2.0.1 fix added `coerce(rest, 'conditions')` / `coerce(rest, 'filter')` etc. to the `*_update`
handlers — but only for the **object** params. Array params like `actions` are still delivered to the
handler as a **JSON string** (because the `*_update` tools declare an untyped `.passthrough()` schema, so
the MCP host stringifies the array), and nothing coerces them back. Zendesk then rejects the stringified
array:

```
trigger_update  actions:[{...}]  →  HTTP 400
{"error":{"title":"Invalid attribute",
 "message":"You passed an invalid value for the trigger.actions attribute.
  Invalid parameter: trigger.actions must be an array from api/v2/rules/triggers/update"}}
```

On the **create** side this same `actions` works — because `trigger_create` declares `actions` as
`z.array(...)` (typed → host passes a real array). The update tools don't declare it, so it breaks.

---

## Live reproduction (2026-07-29)

Fresh grant, admin, scopes `read write hc:write`. Object `conditions` on update works; the array `actions` does not.

**1. `trigger_update` with `actions` array → 400 "must be an array":**
```json
// call
{ "id": 51883425631892,
  "conditions": { "all": [ { "field": "status", "operator": "is", "value": "solved" },
                           { "field": "priority", "operator": "is", "value": "high" } ] },
  "actions": [ { "field": "priority", "value": "urgent" } ] }
// → HTTP 400  trigger.actions must be an array
```

**2. Same `trigger_update` with conditions ONLY (no actions) → 422 business rule (proves conditions DID coerce):**
```json
{ "id": 51883425631892,
  "conditions": { "all": [ { "field": "status", "operator": "is", "value": "solved" },
                           { "field": "priority", "operator": "is", "value": "high" } ] } }
// → HTTP 422  {"error":"RecordInvalid", ... "Trigger must contain at least one action"}
```
A 422 "must contain at least one action" (not a 400 "conditions must be a hash") means `conditions`
serialized correctly as an object — it got past serialization into Zendesk's business-rule validation.
So **object coercion on update is fine; only the array param is broken.**

**3. Passthrough PUT with a real object body → HTTP 200 (workaround; proves API/token/scope all fine):**
```json
// zendesk_api_request
{ "method": "PUT", "path": "/api/v2/triggers/51883425631892.json", "allow_writes": true,
  "body": { "trigger": { "conditions": { "all": [ { "field": "status", "operator": "is", "value": "solved" } ] },
                         "actions": [ { "field": "priority", "value": "urgent" } ] } } }
// → HTTP 200, trigger.actions = [{priority: urgent}], trigger.conditions = {all:[status is solved]}
```
(The passthrough `body` coercion was fixed in v2.0.1, so it accepts the real object and Zendesk gets a
proper hash+array.)

---

## Root cause

The `*_update` tools are declared with an untyped passthrough schema, e.g.:
```ts
// trigger_update inputSchema (illustrative)
z.object({ id: z.number() }).passthrough()   // no typed 'actions' / 'conditions' / 'filter'
```
- A property with **no declared type** → MCP host commonly serializes the value as a **JSON string**.
- v2.0.1 handler does `c.updateTrigger(id, coerce(rest, 'conditions'))` — it parses `conditions` back to an
  object, but leaves `actions` as the raw string.
- `ZendeskApiClient` then `JSON.stringify`s the payload, so `actions` goes out as `"[{...}]"` (a quoted
  string) → Zendesk 400 "must be an array".

Create tools avoid this only because they declare each complex param with a type (`z.array(...)` /
`z.object(...)`), so the host passes real structures.

---

## Recommended fix

Apply the **same `asObject()` coercion the create-side fix uses**, but to the ARRAY params on every
`*_update` handler — not just the object params. `asObject()` already parses a JSON string back to either an
object OR an array, so it works as-is; just add the array keys to the `coerce(...)` list.

```ts
// BEFORE (v2.0.1) — only object params coerced
trigger_update:    (c, {id, ...rest}) => c.updateTrigger(id,    coerce(rest, 'conditions'))
automation_update: (c, {id, ...rest}) => c.updateAutomation(id, coerce(rest, 'conditions'))
view_update:       (c, {id, ...rest}) => c.updateView(id,       coerce(rest, 'conditions', 'execution', 'restriction'))
sla_policy_update: (c, {id, ...rest}) => c.updateSlaPolicy(id,  coerce(rest, 'filter'))
macro_update:      (c, {id, ...rest}) => c.updateMacro(id,      coerce(rest, 'restriction'))

// AFTER — add the ARRAY params (actions especially)
trigger_update:    (c, {id, ...rest}) => c.updateTrigger(id,    coerce(rest, 'conditions', 'actions'))
automation_update: (c, {id, ...rest}) => c.updateAutomation(id, coerce(rest, 'conditions', 'actions'))
view_update:       (c, {id, ...rest}) => c.updateView(id,       coerce(rest, 'conditions', 'execution', 'restriction', 'columns'))
sla_policy_update: (c, {id, ...rest}) => c.updateSlaPolicy(id,  coerce(rest, 'filter', 'policy_metrics'))
macro_update:      (c, {id, ...rest}) => c.updateMacro(id,      coerce(rest, 'restriction', 'actions'))
```

**Audit every `*_update` handler** and coerce ALL of its structured params (objects AND arrays). Grep for
`_update` handlers and cross-check each against the corresponding `*_create` tool's typed params — any param
that is `z.array(...)` or `z.object(...)` on create must be in the update handler's `coerce()` list.

**Secondary (belt & suspenders):** give the `*_update` tools typed schemas instead of bare `.passthrough()`
(reuse the `conditionSet` schema + `actions: z.array(z.record(z.any()))` from the create tools). Keep the
`asObject()` coercion regardless, so the server tolerates any host that still stringifies.

---

## Verification plan (after fix)

For each of `trigger_update`, `automation_update`, `view_update`, `macro_update`:
1. Create the object (create tools already work).
2. `*_update` it, passing a **new `actions`/`conditions`/`filter` set as real structures** → expect **200**,
   and the GET-back shows the updated actions+conditions.
3. Delete the object.

Success criterion: `*_update` with an `actions` array returns 200 (not 400 "must be an array"), and the
change persists. Confirm against the passthrough-PUT result as the known-good baseline.

---

## Appendix: affected update tools (audit list)

`trigger_update.actions`, `automation_update.actions`, `macro_update.actions`, `view_update.columns`
(+ any array param), `sla_policy_update.policy_metrics`. Plus re-verify the object params already coerced in
v2.0.1 still work on update (they do for `conditions`, proven above).
