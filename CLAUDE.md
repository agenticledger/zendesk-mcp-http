# zendesk-mcp-http — build notes & contracts

Broker-first hosted MCP (per-connection OAuth). Reads credentials from the Connections
Broker under its own client namespace. 101 tools. Live at `zendeskmcp.agenticledger.ai`.

## ⚠️ CONTRACT: `CLIENT_NAMESPACE` is load-bearing — do NOT change it silently

As of 2026-07-29 the durable-subject fix ("Zendesk Connect — Durable Subject Fix") makes
this MCP's **read namespace the source of truth** for where connected Zendesk OAuth tokens
land. The gateway's `/connect` aims a Tier-1 `bindTo.namespace` at exactly this value so
the token is written onto the subject this MCP reads (`subject = sha256(clientNamespace :
principal)`).

- Live read namespace = **`zendesk-mcp-prod`** (deploy-time `CLIENT_NAMESPACE` env).
- It is surfaced at `GET /health` → `clientNamespace`. The catalog's
  `brokerClientNamespace` field is populated FROM `/health`, not from a formula.
- **Changing `CLIENT_NAMESPACE`** (e.g. `-v2`, staging rename) **silently orphans every
  connected account** — the gateway keeps aiming at the old namespace, tokens land on a
  subject this MCP no longer reads.

**Rule:** never change `CLIENT_NAMESPACE` / the `/health.clientNamespace` value without
first announcing it in the durable-subject-fix room (@hub gateway + @connectionsbroker +
@mcpsteward catalog must re-aim in lockstep). Treat it as a contract, not a config knob.

## Health truth-shape (broker-first, live)
```
server: zendesk-mcp-http · authModel: broker-first · clientNamespace: zendesk-mcp-prod
principalHeader: x-broker-principal · brokerConfigured: true
```
