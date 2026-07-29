/**
 * READ-ONLY live smoke test — proves the NEW config endpoints are REAL Zendesk
 * endpoints by calling them against the live connection. GET verbs ONLY. Nothing
 * is created/updated/deleted. (Production-safety rule 3c: read-only GET is fine.)
 *
 * Resolves the caller's token from the Connections Broker exactly like the server,
 * then exercises new read tools + a passthrough GET + proves the passthrough refuses
 * a write. Run:  set -a; . ./.env; set +a; npx tsx test/read-smoke.ts
 * Optional: ZTEST_PRINCIPAL=<instanceId:agentId> to target a specific connection.
 */
import { resolveZendeskToken } from '../src/broker-client.js';
import { ZendeskClient } from '../src/api-client.js';
import { tools } from '../src/tools.js';

const principal = process.env.ZTEST_PRINCIPAL || 'default';
const byName = new Map(tools.map((t) => [t.name, t]));
const call = (name: string, args: any = {}, c?: ZendeskClient) => byName.get(name)!.handler(c!, args);

function short(v: any, n = 240) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function main() {
  console.log(`Resolving Zendesk token from broker for principal="${principal}" …`);
  const tok = await resolveZendeskToken(principal);
  if (tok.status !== 'connected') {
    console.log(`✗ Not usable: ${tok.status}${tok.status === 'error' ? ' — ' + tok.message : ''}`);
    console.log(`  (If "not_connected", pass ZTEST_PRINCIPAL=<the connected instanceId:agentId>.)`);
    process.exit(2);
  }
  const host = tok.baseUrl;
  console.log(`✓ Connected. Zendesk host: ${host}\n  READ-ONLY from here on. No writes.\n`);
  const c = new ZendeskClient(tok.accessToken, host);

  // 1. auth proof (existing GET)
  const me = await c.getMe();
  console.log(`whoami: ${me?.user?.email || me?.user?.name || '(no user)'} role=${me?.user?.role}`);

  // 2. NEW read endpoints — each hits a real /api/v2 path
  const probes: Array<[string, () => Promise<any>, (r: any) => string]> = [
    ['ticket_fields_list', () => c.listTicketFields({ per_page: 3 }), (r) => `${r.ticket_fields?.length ?? '?'} fields (first id ${r.ticket_fields?.[0]?.id})`],
    ['trigger_categories_list', () => call('trigger_categories_list', {}, c), (r) => `${r.trigger_categories?.length ?? '?'} categories`],
    ['schedule_list', () => call('schedule_list', {}, c), (r) => `${r.schedules?.length ?? 0} business-hours schedules`],
    ['custom_status_list', () => call('custom_status_list', {}, c), (r) => `${r.custom_statuses?.length ?? '?'} custom statuses`],
    ['sla_policies_list', () => c.listSlaPolicies({}), (r) => `${r.sla_policies?.length ?? '?'} SLA policies (first id ${r.sla_policies?.[0]?.id})`],
    ['macros_list', () => c.listMacros({ per_page: 3 }), (r) => `${r.macros?.length ?? '?'} macros (first id ${r.macros?.[0]?.id})`],
    ['triggers_list', () => c.listTriggers({ per_page: 3 }), (r) => `${r.triggers?.length ?? '?'} triggers (first id ${r.triggers?.[0]?.id})`],
  ];

  let firstFieldId: any, firstSlaId: any, firstTriggerId: any;
  for (const [label, fn, fmt] of probes) {
    try {
      const r = await fn();
      if (label === 'ticket_fields_list') firstFieldId = r.ticket_fields?.[0]?.id;
      if (label === 'sla_policies_list') firstSlaId = r.sla_policies?.[0]?.id;
      if (label === 'triggers_list') firstTriggerId = r.triggers?.[0]?.id;
      console.log(`✓ ${label}: ${fmt(r)}`);
    } catch (e) {
      console.log(`✗ ${label}: ${short(e instanceof Error ? e.message : e)}`);
    }
  }

  // 3. NEW *_get endpoints against real IDs discovered above
  const getters: Array<[string, () => Promise<any>, (r: any) => string]> = [];
  if (firstFieldId) getters.push(['ticket_field_get', () => call('ticket_field_get', { id: String(firstFieldId) }, c), (r) => `${r.ticket_field?.type} "${r.ticket_field?.title}"`]);
  if (firstSlaId) getters.push(['sla_policy_get', () => call('sla_policy_get', { id: String(firstSlaId) }, c), (r) => `"${r.sla_policy?.title}"`]);
  if (firstTriggerId) getters.push(['trigger_get', () => call('trigger_get', { id: String(firstTriggerId) }, c), (r) => `"${r.trigger?.title}" active=${r.trigger?.active}`]);
  for (const [label, fn, fmt] of getters) {
    try { console.log(`✓ ${label}: ${fmt(await fn())}`); }
    catch (e) { console.log(`✗ ${label}: ${short(e instanceof Error ? e.message : e)}`); }
  }

  // 4. passthrough — GET works
  try {
    const r = await call('zendesk_api_request', { method: 'GET', path: '/api/v2/ticket_forms' }, c);
    console.log(`✓ zendesk_api_request GET /ticket_forms: ${r.ticket_forms?.length ?? '?'} forms`);
  } catch (e) { console.log(`✗ passthrough GET: ${short(e instanceof Error ? e.message : e)}`); }

  // 5. passthrough — WRITE is refused with NO call made
  const refused = await call('zendesk_api_request', { method: 'POST', path: '/api/v2/groups', body: { group: { name: 'SHOULD_NOT_HAPPEN' } } }, c);
  console.log(refused?.refused === true
    ? `✓ zendesk_api_request POST refused (no write): ${refused.reason.slice(0, 60)}…`
    : `✗ passthrough POST was NOT refused — SAFETY BUG`);

  console.log(`\nDone. Every call above was GET (or a refused write). Zero objects created/updated/deleted.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
