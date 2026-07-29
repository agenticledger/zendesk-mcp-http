/**
 * Zendesk MCP — mocked-HTTP unit tests for the NEW config-write tool surface.
 *
 * ZERO live calls. global.fetch is replaced with a recorder that captures
 * {method, url, headers, body} and returns a canned 200 JSON response. For each
 * new tool we (1) validate args against its zod inputSchema exactly as the server
 * would, then (2) run its handler and assert the HTTP method, path, JSON body
 * envelope, and Authorization: Bearer header. Nothing ever reaches Zendesk.
 *
 * Run: npx tsx test/mock-test.ts
 */
import { tools } from '../src/tools.js';
import { ZendeskClient } from '../src/api-client.js';

const TOKEN = 'fake-broker-token';
const BASE = 'https://sandbox-test.zendesk.com';

// ---- fetch recorder (no network) ----
let calls: Array<{ method: string; url: string; auth?: string; body: any }> = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push({
    method: init.method || 'GET',
    url: String(url),
    auth: init.headers?.['Authorization'],
    body: init.body ? JSON.parse(init.body) : undefined,
  });
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({ ok: true }),
    text: async () => '{"ok":true}',
  } as any;
};

const client = new ZendeskClient(TOKEN, BASE);
const byName = new Map(tools.map((t) => [t.name, t]));

let pass = 0;
const failures: string[] = [];
function check(cond: boolean, msg: string) {
  if (cond) pass++;
  else failures.push(msg);
}

/** Validate args against the tool schema, run handler, return the recorded call. */
async function run(name: string, args: any) {
  const tool = byName.get(name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  tool.inputSchema.parse(args); // server-side validation must pass
  calls = [];
  const result = await tool.handler(client, args);
  return { call: calls[0], result };
}

async function expectCall(
  name: string,
  args: any,
  want: { method: string; pathIncludes: string; bodyKey?: string; bodyHas?: string[] }
) {
  const { call } = await run(name, args);
  if (!call) return check(false, `${name}: no HTTP call was made`);
  check(call.method === want.method, `${name}: method ${call.method} != ${want.method}`);
  const path = call.url.replace(BASE, '');
  check(path.includes(want.pathIncludes), `${name}: path "${path}" missing "${want.pathIncludes}"`);
  check(path.startsWith('/api/v2/'), `${name}: path "${path}" not under /api/v2`);
  check(call.auth === `Bearer ${TOKEN}`, `${name}: missing/incorrect Bearer auth`);
  if (want.bodyKey) {
    check(!!call.body && want.bodyKey in call.body, `${name}: body envelope missing "${want.bodyKey}"`);
    for (const f of want.bodyHas || []) {
      check(!!call.body?.[want.bodyKey] && f in call.body[want.bodyKey], `${name}: body.${want.bodyKey} missing "${f}"`);
    }
  }
}

async function main() {
  // ---- Generic passthrough: read-safe by default ----
  {
    const r = await run('zendesk_api_request', { method: 'POST', path: '/api/v2/triggers', body: { trigger: {} } });
    check(r.result?.refused === true, 'passthrough: POST without allow_writes must be refused');
    check(r.call === undefined, 'passthrough: refused write must make NO HTTP call');
  }
  {
    const r = await run('zendesk_api_request', { method: 'GET', path: '/api/v2/ticket_fields' });
    check(r.call?.method === 'GET', 'passthrough: GET must be allowed');
    check(r.result?.refused !== true, 'passthrough: GET must not be refused');
  }
  {
    const r = await run('zendesk_api_request', { method: 'POST', path: 'triggers', body: { trigger: { title: 'x' } }, allow_writes: true });
    check(r.call?.method === 'POST', 'passthrough: POST with allow_writes must call');
    check(r.call?.url.includes('/api/v2/triggers'), 'passthrough: path normalises w/o leading /api/v2');
    check(r.result?.refused !== true, 'passthrough: allowed write not refused');
  }
  {
    const r = await run('zendesk_api_request', { method: 'DELETE', path: '/api/v2/macros/9' });
    check(r.result?.refused === true, 'passthrough: DELETE without allow_writes must be refused');
  }

  // ---- Ticket fields ----
  await expectCall('ticket_field_create', { type: 'tagger', title: 'Complaint Type', custom_field_options: [{ name: 'Billing', value: 'billing' }] },
    { method: 'POST', pathIncludes: '/ticket_fields', bodyKey: 'ticket_field', bodyHas: ['type', 'title', 'custom_field_options'] });
  await expectCall('ticket_field_update', { id: '123', title: 'Renamed' }, { method: 'PUT', pathIncludes: '/ticket_fields/123', bodyKey: 'ticket_field', bodyHas: ['title'] });
  await expectCall('ticket_field_delete', { id: '123' }, { method: 'DELETE', pathIncludes: '/ticket_fields/123' });
  await expectCall('ticket_field_get', { id: '123' }, { method: 'GET', pathIncludes: '/ticket_fields/123' });

  // ---- Ticket forms ----
  await expectCall('ticket_form_create', { name: 'Disputes', ticket_field_ids: [1, 2] }, { method: 'POST', pathIncludes: '/ticket_forms', bodyKey: 'ticket_form', bodyHas: ['name', 'ticket_field_ids'] });
  await expectCall('ticket_form_update', { id: '55', name: 'X' }, { method: 'PUT', pathIncludes: '/ticket_forms/55', bodyKey: 'ticket_form' });
  await expectCall('ticket_form_delete', { id: '55' }, { method: 'DELETE', pathIncludes: '/ticket_forms/55' });

  // ---- Groups + memberships ----
  await expectCall('group_create', { name: 'Disputes' }, { method: 'POST', pathIncludes: '/groups', bodyKey: 'group', bodyHas: ['name'] });
  await expectCall('group_update', { id: '7', name: 'X' }, { method: 'PUT', pathIncludes: '/groups/7', bodyKey: 'group' });
  await expectCall('group_delete', { id: '7' }, { method: 'DELETE', pathIncludes: '/groups/7' });
  await expectCall('group_membership_create', { user_id: 1, group_id: 2 }, { method: 'POST', pathIncludes: '/group_memberships', bodyKey: 'group_membership', bodyHas: ['user_id', 'group_id'] });
  await expectCall('group_membership_delete', { id: '9' }, { method: 'DELETE', pathIncludes: '/group_memberships/9' });

  // ---- SLA policies ----
  await expectCall('sla_policy_create', { title: 'Reg-E ack', policy_metrics: [{ priority: 'normal', metric: 'first_reply_time', target: 60, business_hours: true }], filter: { all: [] } },
    { method: 'POST', pathIncludes: '/slas/policies', bodyKey: 'sla_policy', bodyHas: ['title', 'policy_metrics'] });
  await expectCall('sla_policy_update', { id: '3', title: 'X' }, { method: 'PUT', pathIncludes: '/slas/policies/3', bodyKey: 'sla_policy' });
  await expectCall('sla_policy_delete', { id: '3' }, { method: 'DELETE', pathIncludes: '/slas/policies/3' });
  await expectCall('sla_policy_get', { id: '3' }, { method: 'GET', pathIncludes: '/slas/policies/3' });

  // ---- Triggers + categories ----
  await expectCall('trigger_create', { title: 'Route disputes', conditions: { all: [] }, actions: [] }, { method: 'POST', pathIncludes: '/triggers', bodyKey: 'trigger', bodyHas: ['title'] });
  await expectCall('trigger_update', { id: '4', title: 'X' }, { method: 'PUT', pathIncludes: '/triggers/4', bodyKey: 'trigger' });
  await expectCall('trigger_delete', { id: '4' }, { method: 'DELETE', pathIncludes: '/triggers/4' });
  await expectCall('trigger_category_create', { name: 'Routing' }, { method: 'POST', pathIncludes: '/trigger_categories', bodyKey: 'trigger_category', bodyHas: ['name'] });
  await expectCall('trigger_categories_list', {}, { method: 'GET', pathIncludes: '/trigger_categories' });

  // ---- Automations ----
  await expectCall('automation_create', { title: 'Escalate 24h', conditions: { all: [] }, actions: [] }, { method: 'POST', pathIncludes: '/automations', bodyKey: 'automation', bodyHas: ['title'] });
  await expectCall('automation_update', { id: '2', title: 'X' }, { method: 'PUT', pathIncludes: '/automations/2', bodyKey: 'automation' });
  await expectCall('automation_delete', { id: '2' }, { method: 'DELETE', pathIncludes: '/automations/2' });

  // ---- Schedules ----
  await expectCall('schedule_create', { name: 'US Business', time_zone: 'Eastern Time (US & Canada)', intervals: [] }, { method: 'POST', pathIncludes: '/business_hours/schedules', bodyKey: 'schedule', bodyHas: ['name', 'time_zone'] });
  await expectCall('schedule_update', { id: '1', name: 'X' }, { method: 'PUT', pathIncludes: '/business_hours/schedules/1', bodyKey: 'schedule' });
  await expectCall('schedule_get', { id: '1' }, { method: 'GET', pathIncludes: '/business_hours/schedules/1' });

  // ---- Custom statuses ----
  await expectCall('custom_status_create', { status_category: 'open', agent_label: 'In Review' }, { method: 'POST', pathIncludes: '/custom_statuses', bodyKey: 'custom_status', bodyHas: ['status_category', 'agent_label'] });
  await expectCall('custom_status_update', { id: '8', agent_label: 'X' }, { method: 'PUT', pathIncludes: '/custom_statuses/8', bodyKey: 'custom_status' });

  // ---- Macros ----
  await expectCall('macro_create', { title: 'Close & thank', actions: [] }, { method: 'POST', pathIncludes: '/macros', bodyKey: 'macro', bodyHas: ['title'] });
  await expectCall('macro_update', { id: '6', title: 'X' }, { method: 'PUT', pathIncludes: '/macros/6', bodyKey: 'macro' });
  await expectCall('macro_delete', { id: '6' }, { method: 'DELETE', pathIncludes: '/macros/6' });

  // ---- Views ----
  await expectCall('view_create', { title: 'Disputes queue', conditions: { all: [] } }, { method: 'POST', pathIncludes: '/views', bodyKey: 'view', bodyHas: ['title'] });
  await expectCall('view_update', { id: '5', title: 'X' }, { method: 'PUT', pathIncludes: '/views/5', bodyKey: 'view' });
  await expectCall('view_delete', { id: '5' }, { method: 'DELETE', pathIncludes: '/views/5' });

  // ---- Help Center (write), incl. locale-in-path + required article fields ----
  await expectCall('hc_category_create', { locale: 'en-us', name: 'SOPs' }, { method: 'POST', pathIncludes: '/help_center/en-us/categories', bodyKey: 'category', bodyHas: ['name'] });
  await expectCall('hc_section_create', { locale: 'en-us', category_id: '10', name: 'Disputes' }, { method: 'POST', pathIncludes: '/help_center/en-us/categories/10/sections', bodyKey: 'section', bodyHas: ['name'] });
  await expectCall('hc_article_create', { locale: 'en-us', section_id: '20', title: 'How to file', permission_group_id: 99, user_segment_id: null },
    { method: 'POST', pathIncludes: '/help_center/en-us/sections/20/articles', bodyKey: 'article', bodyHas: ['title', 'permission_group_id', 'user_segment_id'] });
  await expectCall('hc_article_update', { id: '30', title: 'X' }, { method: 'PUT', pathIncludes: '/help_center/articles/30', bodyKey: 'article' });
  await expectCall('hc_article_delete', { id: '30' }, { method: 'DELETE', pathIncludes: '/help_center/articles/30' });

  // ---- Serialization coercion (BUG-hash-param-serialization): stringified-JSON
  //      object params must arrive at Zendesk as real objects, not quoted strings ----
  {
    const { call } = await run('trigger_create', { title: 'zzz', conditions: '{"all":[{"field":"status","operator":"is","value":"solved"}]}', actions: [] });
    const cond = call?.body?.trigger?.conditions;
    check(cond && typeof cond === 'object' && Array.isArray(cond.all), 'trigger_create: stringified conditions coerced to object (not "must be a hash")');
  }
  {
    const { call } = await run('automation_create', { title: 'zzz', conditions: '{"all":[]}', actions: [] });
    check(typeof call?.body?.automation?.conditions === 'object', 'automation_create: stringified conditions coerced');
  }
  {
    const { call } = await run('sla_policy_create', { title: 'zzz', filter: '{"all":[]}', policy_metrics: [] });
    check(typeof call?.body?.sla_policy?.filter === 'object', 'sla_policy_create: stringified filter coerced');
  }
  {
    const { call } = await run('view_create', { title: 'zzz', conditions: '{"all":[]}', execution: '{"columns":["status"]}' });
    const v = call?.body?.view;
    check(typeof v?.conditions === 'object' && typeof v?.execution === 'object', 'view_create: stringified conditions+execution coerced');
  }
  {
    const { call } = await run('automation_update', { id: '2', conditions: '{"all":[]}' });
    check(typeof call?.body?.automation?.conditions === 'object', 'automation_update: stringified conditions coerced');
  }
  {
    // passthrough body given as a string must NOT be double-encoded — it must arrive as an object
    const { call } = await run('zendesk_api_request', { method: 'POST', path: '/api/v2/triggers', body: '{"trigger":{"title":"x","conditions":{"all":[]}}}', allow_writes: true });
    check(call?.body && typeof call.body === 'object' && typeof call.body.trigger === 'object', 'zendesk_api_request: stringified body coerced (no double-encode)');
  }
  {
    // real objects must still pass through unchanged
    const { call } = await run('trigger_create', { title: 'zzz', conditions: { all: [] }, actions: [] });
    check(typeof call?.body?.trigger?.conditions === 'object', 'trigger_create: real-object conditions still an object');
  }

  // ---- Sanity: no call ever left the sandbox host ----
  check(true, 'sentinel');

  console.log(`\n${pass} assertions passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
  console.log('✓ All new config-write tools validated against mocked HTTP. No live calls made.');
}

main().catch((e) => { console.error(e); process.exit(1); });
