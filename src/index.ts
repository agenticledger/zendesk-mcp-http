#!/usr/bin/env node
/**
 * Zendesk MCP Server — Streamable HTTP, BROKER-FIRST (auth model "B").
 *
 * This MCP holds ZERO Zendesk secrets. It is a *client* of the Connections Broker
 * (https://connectionsbroker.agenticledger.ai), which is the registered Zendesk
 * OAuth app, owns the client_id/secret, runs the consent flow, vaults +
 * auto-refreshes each user's token, and stores the caller's Zendesk host.
 *
 * Credential resolution (per request):
 *   1. Broker-first (default): derive the caller's `principal`, sign a short-lived
 *      JWT, ask the broker POST /token for provider=zendesk -> {accessToken,
 *      meta.baseUrl}, call {baseUrl}/api/v2 directly. If not connected yet, return a
 *      connect-on-first-call message with the broker consent URL (never hard-errors).
 *   2. Raw passthrough escape hatch (holds no secret): if the caller sends
 *      `X-Zendesk-Base-Url` + `Authorization: Bearer <raw-zendesk-access-token>`,
 *      use those directly.
 *
 * Principal transport (the platform-gateway contract):
 *   - `X-Broker-Principal: <instanceId>:<agentId>` set by the gateway (per-agent).
 *   - Optional `X-Broker-Principal-Sig` (HMAC) enforced when BROKER_PRINCIPAL_HMAC_KEY
 *     is set — makes the header unforgeable on the public Railway host.
 *   - No header -> BROKER_FALLBACK_PRINCIPAL (standalone single-principal mode).
 */

import { randomUUID, createHmac } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema as _zodToJsonSchema } from 'zod-to-json-schema';
import { ZendeskClient } from './api-client.js';
import { tools } from './tools.js';
import {
  brokerConfigured,
  brokerBaseUrl,
  brokerClientNamespace,
  brokerProvider,
  resolveZendeskToken,
  startZendeskConnect,
} from './broker-client.js';

// Wrap to avoid TS2589 (excessively deep type instantiation) on Zod schemas.
function zodToJsonSchema(schema: any): any {
  return _zodToJsonSchema(schema);
}

// --- Config ---
const SLUG = 'zendesk';
const PORT = parseInt(process.env.PORT || '3100', 10);
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;

// --- Principal transport (platform-gateway contract) ---
const PRINCIPAL_HEADER = (process.env.BROKER_PRINCIPAL_HEADER || 'x-broker-principal').toLowerCase();
const PRINCIPAL_SIG_HEADER = 'x-broker-principal-sig';
const PRINCIPAL_HMAC_KEY = process.env.BROKER_PRINCIPAL_HMAC_KEY || '';
const FALLBACK_PRINCIPAL = process.env.BROKER_FALLBACK_PRINCIPAL || 'default';

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Derive the broker `principal` for this request. Returns an error only when a
 * principal header is present but its HMAC signature fails (integrity mode).
 */
function derivePrincipal(req: express.Request): { principal: string } | { error: string } {
  const raw = headerValue(req.headers[PRINCIPAL_HEADER]);
  if (raw && raw.trim()) {
    const principal = raw.trim();
    if (PRINCIPAL_HMAC_KEY) {
      const sig = headerValue(req.headers[PRINCIPAL_SIG_HEADER]);
      const expected = createHmac('sha256', PRINCIPAL_HMAC_KEY).update(principal).digest('base64url');
      if (!sig || sig !== expected) {
        return { error: `Missing or invalid ${PRINCIPAL_SIG_HEADER} for the supplied ${PRINCIPAL_HEADER}` };
      }
    }
    return { principal };
  }
  // No principal header -> standalone single-principal mode.
  return { principal: FALLBACK_PRINCIPAL };
}

/** Raw passthrough escape hatch — holds no secret. */
function rawPassthrough(req: express.Request): { accessToken: string; baseUrl: string } | null {
  const baseUrl = headerValue(req.headers['x-zendesk-base-url']);
  if (!baseUrl) return null;
  const auth = req.headers.authorization;
  if (!auth) return null;
  const bearer = auth.replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  return { accessToken: bearer, baseUrl };
}

// --- Express app ---
const app = express();
app.use(express.json());

// ==================== OAuth Authorization Server Metadata ====================
// Claude-CLI OAuth-trap fix: the spec discovery path 404s so Claude CLI never
// auto-initiates an OAuth dance — it uses the broker path.
app.get('/_disabled/oauth-authorization-server', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ==================== SMART ROOT / LANDING ====================
app.get('/', (_req, res) => {
  res.json({
    name: 'Zendesk MCP Server',
    provider: 'AgenticLedger',
    version: '1.0.0',
    description:
      'Access Zendesk Support data — tickets, users, organizations, groups, views, macros, SLAs, satisfaction, and Help Center through MCP tools.',
    mcpEndpoint: '/mcp',
    transport: 'streamable-http',
    tools: tools.length,
    auth: {
      model: 'broker-first',
      description:
        'Credentials are owned by the Connections Broker. On first use the tool returns a one-time connect link; after you connect once, calls just work. No secret is ever pasted into this MCP.',
      broker: brokerBaseUrl,
      principalHeader: PRINCIPAL_HEADER,
      alternativeAuth: {
        type: 'bearer-passthrough',
        description:
          'Escape hatch (no secret held): pass a raw Zendesk access token as Bearer plus X-Zendesk-Base-Url (e.g. https://acme.zendesk.com).',
      },
    },
    configTemplate: {
      mcpServers: {
        zendesk: {
          url: `${SERVER_BASE_URL}/mcp`,
        },
      },
    },
    links: {
      health: '/health',
      documentation: 'https://financemcps.agenticledger.ai/zendesk/',
    },
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'zendesk-mcp-http',
    version: '1.0.0',
    tools: tools.length,
    transport: 'streamable-http',
    authModel: 'broker-first',
    brokerConfigured,
    brokerBaseUrl,
    clientNamespace: brokerConfigured ? brokerClientNamespace : null,
    principalHeader: PRINCIPAL_HEADER,
    authModes: [
      'broker-first (default): resolves Zendesk via the Connections Broker',
      'bearer-passthrough (escape hatch): Authorization + X-Zendesk-Base-Url headers',
    ],
  });
});

// ==================== MCP SERVER ====================

interface SessionState {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, SessionState>();

/**
 * Resolves a ZendeskClient for the current caller at tool-call time, or a
 * connect-on-first-call message, or an error. Bound per session.
 */
type ClientResolution =
  | { kind: 'client'; client: ZendeskClient }
  | { kind: 'connect'; message: string }
  | { kind: 'error'; message: string };

type ClientResolver = () => Promise<ClientResolution>;

function createMCPServer(resolveClient: ClientResolver): Server {
  const server = new Server(
    { name: 'zendesk-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const resolved = await resolveClient();
    if (resolved.kind === 'connect') {
      // Connect-on-first-call: not an error — surface the one-time connect link.
      return { content: [{ type: 'text' as const, text: resolved.message }] };
    }
    if (resolved.kind === 'error') {
      return { content: [{ type: 'text' as const, text: `Error: ${resolved.message}` }], isError: true };
    }

    try {
      const result = await tool.handler(resolved.client, args as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/** Build the connect-on-first-call structured message. */
async function connectMessage(principal: string): Promise<string> {
  const started = await startZendeskConnect(principal);
  if ('error' in started) {
    return `Zendesk isn't connected for this caller yet, and starting a connection failed: ${started.error}`;
  }
  return JSON.stringify(
    {
      status: 'connection_required',
      provider: SLUG,
      message:
        'Zendesk is not connected for this caller yet. Open the connect link below once (sign in to Zendesk and authorize — you will supply your subdomain plus the OAuth client_id/client_secret through the broker connect flow), then run the tool again — it will work.',
      connectUrl: started.authorizeUrl,
    },
    null,
    2
  );
}

// POST /mcp — MCP session entry point
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — pick the credential resolver.
  let resolveClient: ClientResolver;

  const raw = rawPassthrough(req);
  if (raw) {
    const client = new ZendeskClient(raw.accessToken, raw.baseUrl);
    resolveClient = async () => ({ kind: 'client', client });
  } else {
    if (!brokerConfigured) {
      res.status(503).json({
        error: 'Broker not configured on this server.',
        hint: 'Set BROKER_INSTALL_BEARER, BROKER_JWT_KEY, BROKER_CLIENT_NAMESPACE (from the broker /register).',
        alternative: {
          'Authorization': 'Bearer <your-zendesk-access-token>',
          'X-Zendesk-Base-Url': '<https://your-subdomain.zendesk.com>',
        },
      });
      return;
    }
    const derived = derivePrincipal(req);
    if ('error' in derived) {
      res.status(401).json({ error: derived.error });
      return;
    }
    const principal = derived.principal;
    resolveClient = async () => {
      const tok = await resolveZendeskToken(principal);
      if (tok.status === 'connected') {
        return { kind: 'client', client: new ZendeskClient(tok.accessToken, tok.baseUrl) };
      }
      if (tok.status === 'not_connected') {
        return { kind: 'connect', message: await connectMessage(principal) };
      }
      return { kind: 'error', message: tok.message };
    };
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createMCPServer(resolveClient);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) {
      sessions.delete(sid);
      console.log(`[mcp] Session closed: ${sid}`);
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  const newSessionId = transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, { server, transport });
    console.log(`[mcp] New session: ${newSessionId} (mode: ${raw ? 'passthrough' : 'broker'})`);
  }
});

// GET /mcp — SSE stream for server notifications
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session. Send initialization POST first.' });
    return;
  }
  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// DELETE /mcp — close session
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { transport, server } = sessions.get(sessionId)!;
  await transport.close();
  await server.close();
  sessions.delete(sessionId);
  res.status(200).json({ status: 'session closed' });
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`Zendesk MCP HTTP Server v1.0.0 (broker-first)`);
  console.log(`  MCP endpoint:   ${SERVER_BASE_URL}/mcp`);
  console.log(`  Health check:   ${SERVER_BASE_URL}/health`);
  console.log(`  Tools:          ${tools.length}`);
  console.log(`  Transport:      Streamable HTTP`);
  console.log(`  Provider:       ${brokerProvider}`);
  console.log(`  Auth model:     broker-first (${brokerConfigured ? 'broker configured' : 'BROKER NOT CONFIGURED'})`);
  console.log(`  Broker:         ${brokerBaseUrl}`);
  console.log(`  Principal:      header '${PRINCIPAL_HEADER}'${PRINCIPAL_HMAC_KEY ? ' (HMAC-verified)' : ''}, fallback '${FALLBACK_PRINCIPAL}'`);
});
