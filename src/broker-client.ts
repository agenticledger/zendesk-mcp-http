/**
 * Connections-Broker client (auth model "B" — broker-first).
 *
 * This MCP holds ZERO Zendesk secrets. The only secret it carries is a broker
 * *install identity* (installBearer + JWT signing key from the broker's /register),
 * which merely grants "ask MY broker for a token scoped to this caller". It cannot
 * touch any provider OAuth app or any other account's vault.
 *
 * Per request the MCP:
 *   1. derives a `principal` (see index.ts — gateway header or install fallback),
 *   2. signs a short-lived HS256 JWT { clientNamespace, principal },
 *   3. calls the broker (POST /token) to resolve a ready-to-use Zendesk access token
 *      + meta.baseUrl (the caller's Zendesk subdomain host), refreshing in the broker,
 *   4. calls the Zendesk API directly at {baseUrl}/api/v2 with it.
 *
 * The broker's /token echoes `meta.baseUrl` (e.g. https://acme.zendesk.com) but
 * STRIPS client_id/secret — the MCP never learns which OAuth app minted the token,
 * and never hardcodes a subdomain. When the caller hasn't connected Zendesk yet,
 * the broker returns 404 and this module surfaces a connect link (POST /connect ->
 * authorizeUrl) for the one-time consent — the tool never hard-errors.
 *
 * Contract: ~/Desktop/APPs/connections-broker/INTEGRATION.md
 */

import jwt from 'jsonwebtoken';

const BROKER_BASE_URL = (process.env.BROKER_BASE_URL || 'https://connectionsbroker.agenticledger.ai').replace(/\/$/, '');
const INSTALL_BEARER = process.env.BROKER_INSTALL_BEARER || '';
const JWT_KEY = process.env.BROKER_JWT_KEY || '';
const CLIENT_NAMESPACE = process.env.BROKER_CLIENT_NAMESPACE || '';

/** True only when all three install-identity secrets are present. */
export const brokerConfigured = Boolean(INSTALL_BEARER && JWT_KEY && CLIENT_NAMESPACE);

export const brokerBaseUrl = BROKER_BASE_URL;
export const brokerClientNamespace = CLIENT_NAMESPACE;

/** The Zendesk provider name as seeded in the broker (PROVIDER_SEED). */
const ZENDESK_PROVIDER = 'zendesk';
export const brokerProvider = ZENDESK_PROVIDER;

function signBrokerToken(principal: string): string {
  return jwt.sign(
    { clientNamespace: CLIENT_NAMESPACE, principal },
    JWT_KEY,
    { algorithm: 'HS256', expiresIn: '60s' }
  );
}

async function brokerFetch(path: string, principal: string, body: unknown): Promise<Response> {
  return fetch(`${BROKER_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INSTALL_BEARER}`,
      'X-Broker-Token': signBrokerToken(principal),
    },
    body: JSON.stringify(body),
  });
}

export type ZendeskTokenResult =
  | { status: 'connected'; accessToken: string; baseUrl: string; expiresAt: string | null }
  | { status: 'not_connected' }
  | { status: 'error'; message: string };

/**
 * Resolve the caller's Zendesk access token + baseUrl from the broker.
 * 404 -> the caller hasn't connected yet (connect-on-first-call).
 *
 * The broker returns the caller's Zendesk host in `meta.baseUrl` (with a legacy
 * top-level `baseUrl` fallback). We thread this to the api-client so every request
 * targets the right subdomain — nothing is hardcoded here.
 */
export async function resolveZendeskToken(principal: string, account = ''): Promise<ZendeskTokenResult> {
  try {
    const res = await brokerFetch('/token', principal, { provider: ZENDESK_PROVIDER, ...(account ? { account } : {}) });
    if (res.status === 404) return { status: 'not_connected' };
    if (!res.ok) return { status: 'error', message: `broker /token -> ${res.status} ${await res.text()}` };
    const data = (await res.json()) as {
      accessToken?: string;
      expiresAt?: string | null;
      baseUrl?: string;
      meta?: { baseUrl?: string; subdomain?: string } | null;
    };
    if (!data.accessToken) {
      return { status: 'error', message: 'broker /token returned no accessToken (is this a Zendesk connection?)' };
    }
    // Prefer meta.baseUrl; fall back to a legacy top-level baseUrl; last resort derive
    // from meta.subdomain. If none present the connection is misconfigured.
    const baseUrl =
      data.meta?.baseUrl ||
      data.baseUrl ||
      (data.meta?.subdomain ? `https://${data.meta.subdomain}.zendesk.com` : '');
    if (!baseUrl) {
      return { status: 'error', message: 'broker /token returned no meta.baseUrl for this Zendesk connection' };
    }
    return {
      status: 'connected',
      accessToken: data.accessToken,
      baseUrl: baseUrl.replace(/\/$/, ''),
      expiresAt: data.expiresAt ?? null,
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Start a Zendesk connection for the caller and return the one-time consent URL.
 * The user opens it once (Zendesk login -> authorize the OAuth app); the token +
 * subdomain land in the broker vault; the next tool call resolves it. State is
 * single-use, expires in ~10 min.
 */
export async function startZendeskConnect(principal: string, account = ''): Promise<{ authorizeUrl: string } | { error: string }> {
  try {
    const res = await brokerFetch('/connect', principal, { provider: ZENDESK_PROVIDER, ...(account ? { account } : {}) });
    if (!res.ok) return { error: `broker /connect -> ${res.status} ${await res.text()}` };
    const data = (await res.json()) as { authorizeUrl?: string };
    if (!data.authorizeUrl) return { error: 'broker /connect returned no authorizeUrl' };
    return { authorizeUrl: data.authorizeUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
