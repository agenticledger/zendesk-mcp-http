import { z } from 'zod';
import { ZendeskClient } from './api-client.js';

/**
 * Zendesk MCP Tool Definitions — 101 tools.
 *
 * Tickets, Search, Users, Organizations, Groups, Workflow/config,
 * Satisfaction, Help Center (read + write), full CONFIG CRUD (ticket
 * fields/forms, groups, SLA policies, triggers, automations, schedules,
 * custom statuses, macros, views), and a read-safe generic passthrough.
 * All calls target {broker meta.baseUrl}/api/v2. [R]=read (GET), [W]=write.
 */

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (client: ZendeskClient, args: any) => Promise<any>;
}

/** HTTP verbs the generic passthrough refuses unless allow_writes:true. */
const WRITE_VERBS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * No-op spread marker on create schemas. The listed fields are the documented,
 * validated surface; anything more exotic than these goes through
 * `zendesk_api_request` (which sends the raw body untouched).
 */
const passthroughField = {} as Record<string, never>;

/**
 * Coerce a stringified-JSON param back into an object/array.
 *
 * Object-valued params (`conditions`, `filter`, `execution`, passthrough `body`,
 * `restriction`) are declared `z.any()`, which emits a typeless JSON Schema (`{}`).
 * Some MCP hosts serialize such untyped object args as a JSON *string* before they
 * reach the server; `z.any()` then passes the string through and the client
 * re-stringifies it, so Zendesk receives a quoted string and rejects it with
 * `400 "... must be a hash"`. This parses the string back to the real object.
 * Real objects/arrays pass through unchanged, so it's safe either way.
 */
function asObject(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return v; } // leave non-JSON strings alone
}

/** Return a shallow copy of `a` with the named keys run through `asObject`. */
function coerce(a: any, ...keys: string[]): any {
  const out = { ...a };
  for (const k of keys) if (k in out) out[k] = asObject(out[k]);
  return out;
}

/** Cursor + legacy pagination + sort — all optional. */
const pageParams = {
  page_size: z.number().optional().describe('cursor page size (max 100) -> page[size]'),
  page_after: z.string().optional().describe('cursor: next page token -> page[after]'),
  page_before: z.string().optional().describe('cursor: prev page token -> page[before]'),
  per_page: z.number().optional().describe('legacy page size'),
  page: z.number().optional().describe('legacy page number'),
  sort_by: z.string().optional().describe('field to sort by'),
  sort_order: z.enum(['asc', 'desc']).optional().describe('sort direction'),
};

export const tools: ToolDef[] = [
  // ==================== TICKETS (12) ====================
  {
    name: 'tickets_list',
    description: 'List tickets',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listTickets(a),
  },
  {
    name: 'tickets_get',
    description: 'Get a ticket by ID',
    inputSchema: z.object({ id: z.string().describe('ticket ID') }),
    handler: async (c, a) => c.getTicket(a.id),
  },
  {
    name: 'tickets_show_many',
    description: 'Get many tickets by comma-separated IDs',
    inputSchema: z.object({ ids: z.string().describe('comma-separated ticket IDs') }),
    handler: async (c, a) => c.showManyTickets(a.ids),
  },
  {
    name: 'tickets_create',
    description: 'Create a ticket',
    inputSchema: z.object({
      subject: z.string().optional().describe('ticket subject'),
      comment: z.object({
        body: z.string().describe('comment body text'),
        public: z.boolean().optional().describe('public vs internal'),
      }).describe('initial comment'),
      requester_id: z.number().optional().describe('requester user ID'),
      assignee_id: z.number().optional().describe('assignee user ID'),
      group_id: z.number().optional().describe('group ID'),
      priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().describe('priority'),
      type: z.enum(['problem', 'incident', 'question', 'task']).optional().describe('type'),
      status: z.string().optional().describe('status e.g. open, pending'),
      tags: z.array(z.string()).optional().describe('tags'),
      custom_fields: z.array(z.any()).optional().describe('custom field values'),
    }),
    handler: async (c, a) => c.createTicket(a),
  },
  {
    name: 'tickets_update',
    description: 'Update a ticket',
    inputSchema: z.object({
      id: z.string().describe('ticket ID'),
      subject: z.string().optional().describe('updated subject'),
      status: z.string().optional().describe('updated status'),
      priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().describe('priority'),
      assignee_id: z.number().optional().describe('assignee user ID'),
      group_id: z.number().optional().describe('group ID'),
      tags: z.array(z.string()).optional().describe('replace tags'),
      custom_fields: z.array(z.any()).optional().describe('custom field values'),
    }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateTicket(id, rest); },
  },
  {
    name: 'tickets_delete',
    description: 'Delete a ticket',
    inputSchema: z.object({ id: z.string().describe('ticket ID') }),
    handler: async (c, a) => c.deleteTicket(a.id),
  },
  {
    name: 'tickets_merge',
    description: 'Merge tickets into a target ticket',
    inputSchema: z.object({
      id: z.string().describe('target ticket ID'),
      ids: z.array(z.number()).describe('source ticket IDs to merge'),
      source_comment: z.string().optional().describe('comment on sources'),
      target_comment: z.string().optional().describe('comment on target'),
    }),
    handler: async (c, a) => c.mergeTicket(a.id, a.ids, a.source_comment, a.target_comment),
  },
  {
    name: 'tickets_add_comment',
    description: 'Add a comment to a ticket',
    inputSchema: z.object({
      id: z.string().describe('ticket ID'),
      body: z.string().describe('comment body text'),
      public: z.boolean().optional().describe('public vs internal note'),
    }),
    handler: async (c, a) => c.addTicketComment(a.id, a.body, a.public ?? true),
  },
  {
    name: 'tickets_add_tags',
    description: 'Add tags to a ticket',
    inputSchema: z.object({
      id: z.string().describe('ticket ID'),
      tags: z.array(z.string()).describe('tags to add'),
    }),
    handler: async (c, a) => c.addTicketTags(a.id, a.tags),
  },
  {
    name: 'tickets_list_comments',
    description: 'List comments on a ticket',
    inputSchema: z.object({ id: z.string().describe('ticket ID'), ...pageParams }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.listTicketComments(id, rest); },
  },
  {
    name: 'tickets_list_audits',
    description: 'List audits (change log) on a ticket',
    inputSchema: z.object({ id: z.string().describe('ticket ID'), ...pageParams }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.listTicketAudits(id, rest); },
  },
  {
    name: 'tickets_metrics',
    description: 'Get metrics for a ticket',
    inputSchema: z.object({ id: z.string().describe('ticket ID') }),
    handler: async (c, a) => c.getTicketMetrics(a.id),
  },

  // ==================== SEARCH (3) ====================
  {
    name: 'search',
    description: 'Search across tickets, users, orgs',
    inputSchema: z.object({ query: z.string().describe('Zendesk search query'), ...pageParams }),
    handler: async (c, a) => { const { query, ...rest } = a; return c.search(query, rest); },
  },
  {
    name: 'search_count',
    description: 'Count results for a search query',
    inputSchema: z.object({ query: z.string().describe('Zendesk search query') }),
    handler: async (c, a) => c.searchCount(a.query),
  },
  {
    name: 'incremental_tickets',
    description: 'Incremental ticket export (low-rate endpoint)',
    inputSchema: z.object({
      start_time: z.number().describe('unix epoch start time'),
      per_page: z.number().optional().describe('page size (max 1000)'),
    }),
    handler: async (c, a) => c.incrementalTickets(a.start_time, a),
  },

  // ==================== USERS (9) ====================
  {
    name: 'users_list',
    description: 'List users',
    inputSchema: z.object({ role: z.string().optional().describe('filter by role'), ...pageParams }),
    handler: async (c, a) => c.listUsers(a),
  },
  {
    name: 'users_get',
    description: 'Get a user by ID',
    inputSchema: z.object({ id: z.string().describe('user ID') }),
    handler: async (c, a) => c.getUser(a.id),
  },
  {
    name: 'users_search',
    description: 'Search users by name, email, or query',
    inputSchema: z.object({ query: z.string().describe('search query'), ...pageParams }),
    handler: async (c, a) => { const { query, ...rest } = a; return c.searchUsers(query, rest); },
  },
  {
    name: 'users_me',
    description: 'Get the authenticated user',
    inputSchema: z.object({}),
    handler: async (c) => c.getMe(),
  },
  {
    name: 'users_identities',
    description: 'List a user\'s identities',
    inputSchema: z.object({ id: z.string().describe('user ID'), ...pageParams }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.listUserIdentities(id, rest); },
  },
  {
    name: 'users_related',
    description: 'Get counts related to a user',
    inputSchema: z.object({ id: z.string().describe('user ID') }),
    handler: async (c, a) => c.getUserRelated(a.id),
  },
  {
    name: 'users_create',
    description: 'Create a user',
    inputSchema: z.object({
      name: z.string().describe('full name'),
      email: z.string().optional().describe('email address'),
      role: z.enum(['end-user', 'agent', 'admin']).optional().describe('role'),
      phone: z.string().optional().describe('phone number'),
      organization_id: z.number().optional().describe('organization ID'),
      tags: z.array(z.string()).optional().describe('tags'),
      verified: z.boolean().optional().describe('mark identity verified'),
    }),
    handler: async (c, a) => c.createUser(a),
  },
  {
    name: 'users_update',
    description: 'Update a user',
    inputSchema: z.object({
      id: z.string().describe('user ID'),
      name: z.string().optional().describe('updated name'),
      email: z.string().optional().describe('updated email'),
      role: z.enum(['end-user', 'agent', 'admin']).optional().describe('role'),
      phone: z.string().optional().describe('phone number'),
      organization_id: z.number().optional().describe('organization ID'),
      tags: z.array(z.string()).optional().describe('tags'),
    }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateUser(id, rest); },
  },
  {
    name: 'users_delete',
    description: 'Delete (soft) a user',
    inputSchema: z.object({ id: z.string().describe('user ID') }),
    handler: async (c, a) => c.deleteUser(a.id),
  },

  // ==================== ORGANIZATIONS (7) ====================
  {
    name: 'organizations_list',
    description: 'List organizations',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listOrganizations(a),
  },
  {
    name: 'organizations_get',
    description: 'Get an organization by ID',
    inputSchema: z.object({ id: z.string().describe('organization ID') }),
    handler: async (c, a) => c.getOrganization(a.id),
  },
  {
    name: 'organizations_search',
    description: 'Search organizations by exact name',
    inputSchema: z.object({ name: z.string().describe('exact organization name') }),
    handler: async (c, a) => c.searchOrganizations(a.name),
  },
  {
    name: 'organization_memberships',
    description: 'List organization memberships',
    inputSchema: z.object({
      user_id: z.number().optional().describe('filter by user ID'),
      organization_id: z.number().optional().describe('filter by org ID'),
      ...pageParams,
    }),
    handler: async (c, a) => c.listOrganizationMemberships(a),
  },
  {
    name: 'organizations_create',
    description: 'Create an organization',
    inputSchema: z.object({
      name: z.string().describe('organization name'),
      domain_names: z.array(z.string()).optional().describe('email domains'),
      details: z.string().optional().describe('details text'),
      notes: z.string().optional().describe('notes text'),
      tags: z.array(z.string()).optional().describe('tags'),
    }),
    handler: async (c, a) => c.createOrganization(a),
  },
  {
    name: 'organizations_update',
    description: 'Update an organization',
    inputSchema: z.object({
      id: z.string().describe('organization ID'),
      name: z.string().optional().describe('updated name'),
      domain_names: z.array(z.string()).optional().describe('email domains'),
      details: z.string().optional().describe('details text'),
      notes: z.string().optional().describe('notes text'),
      tags: z.array(z.string()).optional().describe('tags'),
    }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateOrganization(id, rest); },
  },
  {
    name: 'organizations_delete',
    description: 'Delete an organization',
    inputSchema: z.object({ id: z.string().describe('organization ID') }),
    handler: async (c, a) => c.deleteOrganization(a.id),
  },

  // ==================== GROUPS (3) ====================
  {
    name: 'groups_list',
    description: 'List groups',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listGroups(a),
  },
  {
    name: 'groups_get',
    description: 'Get a group by ID',
    inputSchema: z.object({ id: z.string().describe('group ID') }),
    handler: async (c, a) => c.getGroup(a.id),
  },
  {
    name: 'group_memberships',
    description: 'List group memberships',
    inputSchema: z.object({
      user_id: z.number().optional().describe('filter by user ID'),
      group_id: z.number().optional().describe('filter by group ID'),
      ...pageParams,
    }),
    handler: async (c, a) => c.listGroupMemberships(a),
  },

  // ==================== WORKFLOW / CONFIG (11) ====================
  {
    name: 'views_list',
    description: 'List views',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listViews(a),
  },
  {
    name: 'views_execute',
    description: 'Execute a view and return rows',
    inputSchema: z.object({ id: z.string().describe('view ID'), ...pageParams }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.executeView(id, rest); },
  },
  {
    name: 'views_tickets',
    description: 'List tickets in a view',
    inputSchema: z.object({ id: z.string().describe('view ID'), ...pageParams }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.listViewTickets(id, rest); },
  },
  {
    name: 'macros_list',
    description: 'List macros',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listMacros(a),
  },
  {
    name: 'macros_apply_preview',
    description: 'Preview a macro\'s changes',
    inputSchema: z.object({ id: z.string().describe('macro ID') }),
    handler: async (c, a) => c.macroApplyPreview(a.id),
  },
  {
    name: 'triggers_list',
    description: 'List triggers',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listTriggers(a),
  },
  {
    name: 'automations_list',
    description: 'List automations',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listAutomations(a),
  },
  {
    name: 'ticket_fields_list',
    description: 'List ticket fields',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listTicketFields(a),
  },
  {
    name: 'ticket_forms_list',
    description: 'List ticket forms',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listTicketForms(a),
  },
  {
    name: 'sla_policies_list',
    description: 'List SLA policies',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listSlaPolicies(a),
  },
  {
    name: 'tags_list',
    description: 'List account tags',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listTags(a),
  },

  // ==================== SATISFACTION (2) ====================
  {
    name: 'satisfaction_ratings_list',
    description: 'List satisfaction ratings',
    inputSchema: z.object({
      score: z.string().optional().describe('filter by score'),
      start_time: z.number().optional().describe('unix epoch start'),
      end_time: z.number().optional().describe('unix epoch end'),
      ...pageParams,
    }),
    handler: async (c, a) => c.listSatisfactionRatings(a),
  },
  {
    name: 'satisfaction_rating_create',
    description: 'Create a satisfaction rating on a ticket',
    inputSchema: z.object({
      id: z.string().describe('ticket ID'),
      score: z.enum(['good', 'bad', 'offered']).describe('rating score'),
      comment: z.string().optional().describe('rating comment'),
    }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.createSatisfactionRating(id, rest); },
  },

  // ==================== HELP CENTER (5, read-only) ====================
  {
    name: 'hc_articles_list',
    description: 'List Help Center articles',
    inputSchema: z.object({ locale: z.string().optional().describe('locale e.g. en-us'), ...pageParams }),
    handler: async (c, a) => c.listHcArticles(a),
  },
  {
    name: 'hc_articles_get',
    description: 'Get a Help Center article by ID',
    inputSchema: z.object({ id: z.string().describe('article ID') }),
    handler: async (c, a) => c.getHcArticle(a.id),
  },
  {
    name: 'hc_articles_search',
    description: 'Search Help Center articles',
    inputSchema: z.object({ query: z.string().describe('search query'), locale: z.string().optional().describe('locale e.g. en-us'), ...pageParams }),
    handler: async (c, a) => { const { query, ...rest } = a; return c.searchHcArticles(query, rest); },
  },
  {
    name: 'hc_sections_list',
    description: 'List Help Center sections',
    inputSchema: z.object({ locale: z.string().optional().describe('locale e.g. en-us'), ...pageParams }),
    handler: async (c, a) => c.listHcSections(a),
  },
  {
    name: 'hc_categories_list',
    description: 'List Help Center categories',
    inputSchema: z.object({ locale: z.string().optional().describe('locale e.g. en-us'), ...pageParams }),
    handler: async (c, a) => c.listHcCategories(a),
  },

  // ==================== GENERIC PASSTHROUGH (1) ====================
  {
    name: 'zendesk_api_request',
    description:
      'Authenticated passthrough to ANY Zendesk /api/v2 endpoint using the same broker OAuth token. ' +
      'GET is always allowed. Write verbs (POST/PUT/DELETE/PATCH) are REFUSED unless allow_writes:true is ' +
      'explicitly passed — this tool never writes by default. Use for endpoints without a curated tool.',
    inputSchema: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      path: z.string().describe('endpoint path, e.g. /api/v2/ticket_fields or ticket_fields/123'),
      query: z.record(z.any()).optional().describe('query-string params as an object'),
      body: z.any().optional().describe('JSON request body (for write verbs)'),
      allow_writes: z.boolean().optional().describe('must be true to permit POST/PUT/DELETE/PATCH; default false'),
    }),
    handler: async (c, a) => {
      const method = String(a.method || 'GET').toUpperCase();
      if (WRITE_VERBS.has(method) && a.allow_writes !== true) {
        return {
          refused: true,
          reason:
            `Write verb ${method} is blocked. zendesk_api_request is read-safe by default; ` +
            `re-call with allow_writes:true to permit this write.`,
        };
      }
      return c.raw(method, a.path, a.query, asObject(a.body));
    },
  },

  // ==================== CONFIG: TICKET FIELDS (4) ====================
  {
    name: 'ticket_field_get',
    description: 'Get a ticket field by ID',
    inputSchema: z.object({ id: z.string().describe('ticket field ID') }),
    handler: async (c, a) => c.getTicketField(a.id),
  },
  {
    name: 'ticket_field_create',
    description: 'Create a custom ticket field (e.g. a tagger dropdown). Pass the raw Zendesk ticket_field object.',
    inputSchema: z.object({
      type: z.string().describe('field type e.g. tagger, text, checkbox, integer, decimal, date, regexp, multiselect'),
      title: z.string().describe('admin title'),
      description: z.string().optional().describe('field description'),
      required: z.boolean().optional().describe('required to solve'),
      active: z.boolean().optional().describe('active'),
      custom_field_options: z.array(z.any()).optional().describe('options for tagger/multiselect: [{name,value}]'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createTicketField(a),
  },
  {
    name: 'ticket_field_update',
    description: 'Update a ticket field. Pass id + any ticket_field attributes to change.',
    inputSchema: z.object({ id: z.string().describe('ticket field ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateTicketField(id, rest); },
  },
  {
    name: 'ticket_field_delete',
    description: 'Delete a ticket field',
    inputSchema: z.object({ id: z.string().describe('ticket field ID') }),
    handler: async (c, a) => c.deleteTicketField(a.id),
  },

  // ==================== CONFIG: TICKET FORMS (4) ====================
  {
    name: 'ticket_form_get',
    description: 'Get a ticket form by ID',
    inputSchema: z.object({ id: z.string().describe('ticket form ID') }),
    handler: async (c, a) => c.getTicketForm(a.id),
  },
  {
    name: 'ticket_form_create',
    description: 'Create a ticket form. ticket_field_ids orders the fields on the form.',
    inputSchema: z.object({
      name: z.string().describe('form name'),
      ticket_field_ids: z.array(z.number()).optional().describe('ordered field IDs'),
      active: z.boolean().optional().describe('active'),
      end_user_visible: z.boolean().optional().describe('visible to end users'),
      default: z.boolean().optional().describe('make default form'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createTicketForm(a),
  },
  {
    name: 'ticket_form_update',
    description: 'Update a ticket form. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('ticket form ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateTicketForm(id, rest); },
  },
  {
    name: 'ticket_form_delete',
    description: 'Delete a ticket form',
    inputSchema: z.object({ id: z.string().describe('ticket form ID') }),
    handler: async (c, a) => c.deleteTicketForm(a.id),
  },

  // ==================== CONFIG: GROUPS + MEMBERSHIPS (5) ====================
  {
    name: 'group_create',
    description: 'Create a group',
    inputSchema: z.object({
      name: z.string().describe('group name'),
      description: z.string().optional().describe('group description'),
      default: z.boolean().optional().describe('make default group'),
    }),
    handler: async (c, a) => c.createGroup(a),
  },
  {
    name: 'group_update',
    description: 'Update a group',
    inputSchema: z.object({
      id: z.string().describe('group ID'),
      name: z.string().optional().describe('updated name'),
      description: z.string().optional().describe('updated description'),
    }),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateGroup(id, rest); },
  },
  {
    name: 'group_delete',
    description: 'Delete a group',
    inputSchema: z.object({ id: z.string().describe('group ID') }),
    handler: async (c, a) => c.deleteGroup(a.id),
  },
  {
    name: 'group_membership_create',
    description: 'Add a user to a group',
    inputSchema: z.object({
      user_id: z.number().describe('user ID'),
      group_id: z.number().describe('group ID'),
      default: z.boolean().optional().describe('make this the user\'s default group'),
    }),
    handler: async (c, a) => c.createGroupMembership(a),
  },
  {
    name: 'group_membership_delete',
    description: 'Remove a group membership by its membership ID',
    inputSchema: z.object({ id: z.string().describe('group membership ID') }),
    handler: async (c, a) => c.deleteGroupMembership(a.id),
  },

  // ==================== CONFIG: SLA POLICIES (4) ====================
  {
    name: 'sla_policy_get',
    description: 'Get an SLA policy by ID',
    inputSchema: z.object({ id: z.string().describe('SLA policy ID') }),
    handler: async (c, a) => c.getSlaPolicy(a.id),
  },
  {
    name: 'sla_policy_create',
    description:
      'Create an SLA policy. filter selects tickets; policy_metrics sets targets ' +
      '(e.g. [{priority:"normal",metric:"first_reply_time",target:60,business_hours:false}]).',
    inputSchema: z.object({
      title: z.string().describe('policy title'),
      description: z.string().optional().describe('description'),
      position: z.number().optional().describe('evaluation order'),
      filter: z.any().optional().describe('{all:[...],any:[...]} condition set'),
      policy_metrics: z.array(z.any()).optional().describe('SLA targets'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createSlaPolicy(coerce(a, 'filter')),
  },
  {
    name: 'sla_policy_update',
    description: 'Update an SLA policy. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('SLA policy ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateSlaPolicy(id, coerce(rest, 'filter')); },
  },
  {
    name: 'sla_policy_delete',
    description: 'Delete an SLA policy',
    inputSchema: z.object({ id: z.string().describe('SLA policy ID') }),
    handler: async (c, a) => c.deleteSlaPolicy(a.id),
  },

  // ==================== CONFIG: TRIGGERS + CATEGORIES (6) ====================
  {
    name: 'trigger_get',
    description: 'Get a trigger by ID',
    inputSchema: z.object({ id: z.string().describe('trigger ID') }),
    handler: async (c, a) => c.getTrigger(a.id),
  },
  {
    name: 'trigger_create',
    description:
      'Create a trigger. conditions {all:[...],any:[...]} + actions [...]. Optionally set category_id.',
    inputSchema: z.object({
      title: z.string().describe('trigger title'),
      conditions: z.any().optional().describe('{all:[...],any:[...]}'),
      actions: z.array(z.any()).optional().describe('actions to run'),
      active: z.boolean().optional().describe('active'),
      category_id: z.string().optional().describe('trigger category ID'),
      position: z.number().optional().describe('order'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createTrigger(coerce(a, 'conditions')),
  },
  {
    name: 'trigger_update',
    description: 'Update a trigger. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('trigger ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateTrigger(id, coerce(rest, 'conditions')); },
  },
  {
    name: 'trigger_delete',
    description: 'Delete a trigger',
    inputSchema: z.object({ id: z.string().describe('trigger ID') }),
    handler: async (c, a) => c.deleteTrigger(a.id),
  },
  {
    name: 'trigger_categories_list',
    description: 'List trigger categories',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listTriggerCategories(a),
  },
  {
    name: 'trigger_category_create',
    description: 'Create a trigger category',
    inputSchema: z.object({ name: z.string().describe('category name') }),
    handler: async (c, a) => c.createTriggerCategory(a),
  },

  // ==================== CONFIG: AUTOMATIONS (4) ====================
  {
    name: 'automation_get',
    description: 'Get an automation by ID',
    inputSchema: z.object({ id: z.string().describe('automation ID') }),
    handler: async (c, a) => c.getAutomation(a.id),
  },
  {
    name: 'automation_create',
    description:
      'Create an automation (time-based). conditions must include a time condition; actions [...].',
    inputSchema: z.object({
      title: z.string().describe('automation title'),
      conditions: z.any().optional().describe('{all:[...],any:[...]}'),
      actions: z.array(z.any()).optional().describe('actions to run'),
      active: z.boolean().optional().describe('active'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createAutomation(coerce(a, 'conditions')),
  },
  {
    name: 'automation_update',
    description: 'Update an automation. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('automation ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateAutomation(id, coerce(rest, 'conditions')); },
  },
  {
    name: 'automation_delete',
    description: 'Delete an automation',
    inputSchema: z.object({ id: z.string().describe('automation ID') }),
    handler: async (c, a) => c.deleteAutomation(a.id),
  },

  // ==================== CONFIG: BUSINESS-HOURS SCHEDULES (4) ====================
  {
    name: 'schedule_list',
    description: 'List business-hours schedules',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listSchedules(a),
  },
  {
    name: 'schedule_get',
    description: 'Get a business-hours schedule by ID',
    inputSchema: z.object({ id: z.string().describe('schedule ID') }),
    handler: async (c, a) => c.getSchedule(a.id),
  },
  {
    name: 'schedule_create',
    description:
      'Create a business-hours schedule. intervals are minutes-from-Sunday-midnight ' +
      '[{start_time,end_time}] blocks; time_zone e.g. "Eastern Time (US & Canada)".',
    inputSchema: z.object({
      name: z.string().describe('schedule name'),
      time_zone: z.string().describe('schedule time zone'),
      intervals: z.array(z.any()).optional().describe('work-week intervals'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createSchedule(a),
  },
  {
    name: 'schedule_update',
    description: 'Update a business-hours schedule. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('schedule ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateSchedule(id, rest); },
  },

  // ==================== CONFIG: CUSTOM STATUSES (3) ====================
  {
    name: 'custom_status_list',
    description: 'List custom ticket statuses',
    inputSchema: z.object({ ...pageParams }),
    handler: async (c, a) => c.listCustomStatuses(a),
  },
  {
    name: 'custom_status_create',
    description: 'Create a custom ticket status under a status_category (new/open/pending/hold/solved).',
    inputSchema: z.object({
      status_category: z.enum(['new', 'open', 'pending', 'hold', 'solved']).describe('base status category'),
      agent_label: z.string().describe('label agents see'),
      end_user_label: z.string().optional().describe('label end users see'),
      description: z.string().optional().describe('description'),
      active: z.boolean().optional().describe('active'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createCustomStatus(a),
  },
  {
    name: 'custom_status_update',
    description: 'Update a custom ticket status. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('custom status ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateCustomStatus(id, rest); },
  },

  // ==================== CONFIG: MACROS (4) ====================
  {
    name: 'macro_get',
    description: 'Get a macro by ID',
    inputSchema: z.object({ id: z.string().describe('macro ID') }),
    handler: async (c, a) => c.getMacro(a.id),
  },
  {
    name: 'macro_create',
    description: 'Create a macro. actions [...] apply to a ticket when the macro is run.',
    inputSchema: z.object({
      title: z.string().describe('macro title'),
      actions: z.array(z.any()).optional().describe('actions to apply'),
      active: z.boolean().optional().describe('active'),
      description: z.string().optional().describe('description'),
      restriction: z.any().optional().describe('group/agent restriction'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createMacro(coerce(a, 'restriction')),
  },
  {
    name: 'macro_update',
    description: 'Update a macro. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('macro ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateMacro(id, rest); },
  },
  {
    name: 'macro_delete',
    description: 'Delete a macro',
    inputSchema: z.object({ id: z.string().describe('macro ID') }),
    handler: async (c, a) => c.deleteMacro(a.id),
  },

  // ==================== CONFIG: VIEWS (3) ====================
  {
    name: 'view_create',
    description: 'Create a view. conditions {all:[...],any:[...]} + execution columns/group/sort.',
    inputSchema: z.object({
      title: z.string().describe('view title'),
      conditions: z.any().optional().describe('{all:[...],any:[...]}'),
      execution: z.any().optional().describe('columns/group/sort config'),
      active: z.boolean().optional().describe('active'),
      restriction: z.any().optional().describe('group/agent restriction'),
      ...passthroughField,
    }),
    handler: async (c, a) => c.createView(coerce(a, 'conditions', 'execution', 'restriction')),
  },
  {
    name: 'view_update',
    description: 'Update a view. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('view ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateView(id, coerce(rest, 'conditions', 'execution', 'restriction')); },
  },
  {
    name: 'view_delete',
    description: 'Delete a view',
    inputSchema: z.object({ id: z.string().describe('view ID') }),
    handler: async (c, a) => c.deleteView(a.id),
  },

  // ==================== HELP CENTER (write) (7) ====================
  {
    name: 'hc_category_create',
    description: 'Create a Help Center category',
    inputSchema: z.object({
      locale: z.string().describe('locale e.g. en-us'),
      name: z.string().describe('category name'),
      description: z.string().optional().describe('description'),
      position: z.number().optional().describe('order'),
    }),
    handler: async (c, a) => { const { locale, ...category } = a; return c.createHcCategory(locale, category); },
  },
  {
    name: 'hc_category_update',
    description: 'Update a Help Center category. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('category ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateHcCategory(id, rest); },
  },
  {
    name: 'hc_section_create',
    description: 'Create a Help Center section under a category',
    inputSchema: z.object({
      locale: z.string().describe('locale e.g. en-us'),
      category_id: z.string().describe('parent category ID'),
      name: z.string().describe('section name'),
      description: z.string().optional().describe('description'),
      position: z.number().optional().describe('order'),
    }),
    handler: async (c, a) => { const { locale, category_id, ...section } = a; return c.createHcSection(locale, category_id, section); },
  },
  {
    name: 'hc_section_update',
    description: 'Update a Help Center section. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('section ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateHcSection(id, rest); },
  },
  {
    name: 'hc_article_create',
    description:
      'Create a Help Center article under a section. NOTE: Zendesk requires permission_group_id ' +
      '(who can edit) and user_segment_id (who can view; null = everyone) on create.',
    inputSchema: z.object({
      locale: z.string().describe('locale e.g. en-us'),
      section_id: z.string().describe('parent section ID'),
      title: z.string().describe('article title'),
      body: z.string().optional().describe('HTML body'),
      permission_group_id: z.number().describe('required: editing permission group ID'),
      user_segment_id: z.number().nullable().optional().describe('viewing segment ID; null = everyone'),
      draft: z.boolean().optional().describe('save as draft'),
      ...passthroughField,
    }),
    handler: async (c, a) => { const { locale, section_id, ...article } = a; return c.createHcArticle(locale, section_id, article); },
  },
  {
    name: 'hc_article_update',
    description: 'Update a Help Center article. Pass id + attributes to change.',
    inputSchema: z.object({ id: z.string().describe('article ID') }).passthrough(),
    handler: async (c, a) => { const { id, ...rest } = a; return c.updateHcArticle(id, rest); },
  },
  {
    name: 'hc_article_delete',
    description: 'Delete a Help Center article',
    inputSchema: z.object({ id: z.string().describe('article ID') }),
    handler: async (c, a) => c.deleteHcArticle(a.id),
  },
];
