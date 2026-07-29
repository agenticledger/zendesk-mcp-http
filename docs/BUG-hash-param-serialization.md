# BUG: Object/hash params (`conditions`, `filter`, `execution`, passthrough `body`) are sent to Zendesk as JSON *strings*

**Component:** `zendesk-mcp-http` (this repo) — MCP tool layer
**Severity:** High — blocks creation of triggers, automations, SLA policies, and views via the curated tools (i.e. the routing / escalation / SLA / agent-workspace half of any Zendesk buildout).
**Status:** Confirmed & root-caused against live prod (`bastionsupport.zendesk.com`) on 2026-07-29.
**NOT the cause:** OAuth scope, Zendesk permissions, the connections broker, or the gateway. Those were independently verified working (see "What this is NOT" below).

---

## TL;DR for the fix

Several tools declare object-valued parameters as bare `z.any()`:

| Tool | Param | Line (`src/tools.ts`) |
|---|---|---|
| `sla_policy_create` | `filter` | 610 |
| `trigger_create` | `conditions` | 642 |
| `automation_create` | `conditions` | 689 |
| `view_create` | `conditions`, `execution` | 808–809 |
| `zendesk_api_request` | `body` | 466 |

A bare `z.any()` emits a JSON Schema of `{}` — **no `"type"`**. When a param has no declared type, the MCP host/client serializes the object argument as a **JSON-encoded string** before it reaches the server. `z.any()` accepts the string unchanged, the handler forwards it, and `ZendeskApiClient.request()` then does `JSON.stringify(body)` — producing a body where `conditions`/`filter` is a **quoted string**, not a hash. Zendesk rejects it.

**Fix:** coerce stringified-JSON back to objects for these fields (and/or give them a typed schema). One-line-per-field defensive parse is the robust option — see "Recommended fix."

---

## Reproduction (live, 2026-07-29)

Auth in use: broker OAuth token `id 51881930614932`, scopes **`["read","write","hc:write"]`** (admin user). Write scope is present and proven — see below.

### These SUCCEEDED (clean create + delete)
| Tool | Result |
|---|---|
| `ticket_field_create` (tagger + `custom_field_options`) | ✅ 201, id `51881974963092`, deleted |
| `group_create` | ✅ 201, id `51882033076884`, deleted |
| `macro_create` (with `actions`) | ✅ 201, id `51882077194260`, deleted |
| `ticket_form_create` | ✅ 201, id `51882033396244`, deleted |

### These FAILED (curated tools) — HTTP 400, *not* 403
Call:
```json
// trigger_create
{ "title": "zzz", "active": false,
  "conditions": { "all": [ { "field": "status", "operator": "is", "value": "solved" } ] },
  "actions": [ { "field": "priority", "value": "low" } ] }
```
Response:
```json
HTTP 400
{"error":{"title":"Invalid attribute",
 "message":"You passed an invalid value for the trigger.conditions attribute. Invalid parameter: trigger.conditions must be a hash from api/v2/rules/triggers/create"}}
```
Identical shape for:
- `automation_create` → `automation.conditions must be a hash`
- `sla_policy_create` → `sla_policy.filter must be a hash`
- `view_create` → `view.conditions must be a hash`

> `400 "must be a hash"` = Zendesk received a **string** where it expects an object. A permissions failure would be `403`. We got `400`, so the field value arrived mis-typed.

### Passthrough (`zendesk_api_request`) — same root cause, worse symptom
Sending the same objects as a raw `body` returned `422`s including `param is missing or the value is empty or invalid: sla_policy` and `Invalid conditions. You must select at least one condition.` — consistent with the `body` string being **double-encoded** (see analysis).

---

## Root-cause analysis

### 1. The API client is correct — do not change it
`src/api-client.ts`:
```ts
// request() — line ~48
...(body !== undefined ? { body: JSON.stringify(body) } : {}),

// createTrigger — line 216
async createTrigger(trigger: any) {
  return this.request('/triggers', { method: 'POST', body: { trigger } });
}
```
If `trigger.conditions` were a real object, this serializes correctly. The client stringifies exactly once. **No bug here.**

### 2. The handlers forward args verbatim — correct
`src/tools.ts`:
```ts
handler: async (c, a) => c.createTrigger(a),   // line 649
```
Whatever `a.conditions` is, it's passed straight through.

### 3. The schema is the defect
`src/tools.ts`:
```ts
conditions: z.any().optional().describe('{all:[...],any:[...]}'),   // line 642
filter:     z.any().optional().describe('{all:[...],any:[...]} condition set'), // line 610
execution:  z.any().optional().describe('columns/group/sort config'),          // line 809
body:       z.any().optional().describe('JSON request body (for write verbs)'), // line 466
```
`z.any()` → JSON Schema `{}` (no `"type"`). For a property with no type, MCP hosts commonly pass the value as a **stringified JSON blob**. `z.any()` does no coercion, so the handler receives:
```js
a.conditions === '{"all":[{"field":"status","operator":"is","value":"solved"}]}'  // a STRING
```
Then:
```js
JSON.stringify({ trigger: { conditions: "{\"all\":[...]}" , ... } })
// → Zendesk sees "conditions": "{...}"  → 400 "must be a hash"
```

### 4. Why the working tools work — the distinguishing factor
The tools that succeeded pass their complex data through **typed** params:
- `ticket_field_create.custom_field_options` → `z.array(z.any())` → JSON Schema `type: "array"` → host passes a real array.
- `macro_create.actions` → `z.array(z.any())` → array → fine.
- `group_create` / `ticket_form_create` → only scalar/array params, no bare-`z.any()` object.

So it's precisely the **bare `z.any()` object params** that break. Arrays (`z.array(...)`) advertise a type and survive; untyped objects do not.

### 5. The passthrough double-encode
`zendesk_api_request` handler (line ~479): `return c.raw(method, a.path, a.query, a.body);`
`a.body` (bare `z.any()`) arrives as a **string** `S`. `raw()` → `request({ body: S })` → `JSON.stringify(S)` wraps it into a JSON **string literal** (`"\"{\\\"sla_policy\\\":...}\""`). Zendesk parses that to a string, not an object → `param is missing: sla_policy` and mangled/empty conditions. Same root cause (untyped object param delivered as a string), compounded by re-stringification.

---

## Recommended fix

**Primary (defensive, host-agnostic): coerce stringified JSON → object for these fields.**
Add a tiny helper and apply it in the affected handlers (or centrally in the dispatch layer):

```ts
/** If an MCP host delivered an object param as a JSON string, parse it back. */
function asObject(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return v; } // leave non-JSON strings alone
}
```

Apply in handlers:
```ts
// trigger_create
handler: async (c, a) => c.createTrigger({ ...a, conditions: asObject(a.conditions) }),
// automation_create
handler: async (c, a) => c.createAutomation({ ...a, conditions: asObject(a.conditions) }),
// sla_policy_create
handler: async (c, a) => c.createSlaPolicy({ ...a, filter: asObject(a.filter) }),
// view_create
handler: async (c, a) => c.createView({ ...a, conditions: asObject(a.conditions), execution: asObject(a.execution) }),
// zendesk_api_request
handler: async (c, a) => { /* ...write guard... */ return c.raw(method, a.path, a.query, asObject(a.body)); },
```
Also apply to the `*_update` tools that use `.passthrough()` (`trigger_update`, `automation_update`, `sla_policy_update`, `view_update`) — they take the same `conditions`/`filter` shapes and will hit the identical bug on update.

**Secondary (self-documenting, and helps well-behaved hosts pass real objects): give the fields a typed schema** instead of bare `z.any()`:
```ts
const conditionSet = z.object({
  all: z.array(z.record(z.any())).optional(),
  any: z.array(z.record(z.any())).optional(),
}).passthrough();

conditions: conditionSet.optional().describe('{all:[...],any:[...]}'),
filter:     conditionSet.optional().describe('{all:[...],any:[...]} condition set'),
```
Keep the `asObject()` coercion even if you tighten schemas — it makes the server tolerant of any host that still stringifies. Belt and suspenders.

---

## Verification / test plan (after fix)

Run against a sandbox (or prod with immediate delete). All should return **201**, then delete:

1. **trigger_create**
   ```json
   { "title": "zzz_verify", "active": false,
     "conditions": { "all": [ { "field": "status", "operator": "is", "value": "solved" } ] },
     "actions": [ { "field": "priority", "value": "low" } ] }
   ```
2. **view_create**
   ```json
   { "title": "zzz_verify", "active": false,
     "conditions": { "all": [ { "field": "status", "operator": "is", "value": "open" } ] },
     "execution": { "columns": ["status"] } }
   ```
3. **sla_policy_create**
   ```json
   { "title": "zzz_verify",
     "filter": { "all": [ { "field": "priority", "operator": "is", "value": "normal" } ] },
     "policy_metrics": [ { "priority": "normal", "metric": "first_reply_time", "target": 60, "business_hours": false } ] }
   ```
4. **automation_create** — see note below on the time condition.
5. **zendesk_api_request** POST `/api/v2/triggers.json` with body `{ "trigger": { ...as #1... } }` → 201.

Success criterion: the request reaches Zendesk with `conditions`/`filter` as a **JSON object** (201 create), not a 400 "must be a hash".

---

## What this is NOT (so it isn't chased down the wrong path)

- **Not an auth/scope problem.** Token scopes are `read write hc:write`; `ticket_field_create` (a `write`-gated config write) succeeded with a clean 201 on the same token. A scope failure returns **403 "missing required scopes"**; these return **400/422**.
- **Not a Zendesk outage or endpoint issue.** Zendesk is correctly rejecting a malformed payload.
- **Not the connections broker / gateway subject binding.** That was a separate, already-resolved issue.
- **`automation_create` also needs a valid *time* condition** (Zendesk business rule — automations must contain at least one time-based condition, e.g. hours since a status). That validation (`422 "must select at least one condition"`) is **separate** from this serialization bug; verify #4 with a correct time condition once the hash issue is fixed, and don't mistake it for a regression.

---

## Appendix: affected vs. unaffected tool inventory

**Affected (bare `z.any()` object param):**
`sla_policy_create.filter`, `sla_policy_update`, `trigger_create.conditions`, `trigger_update`, `automation_create.conditions`, `automation_update`, `view_create.conditions`, `view_create.execution`, `view_update`, `zendesk_api_request.body`. Also review any other `z.any()` object param (e.g. `macro_create.restriction`, `view_create.restriction`) — same failure mode if an object is passed.

**Unaffected (typed params):** `ticket_field_create`, `group_create`, `macro_create` (actions only), `ticket_form_create`, and all scalar/array-only tools.
