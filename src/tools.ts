import { z } from 'zod';
import { ZendeskClient } from './api-client.js';

/**
 * Zendesk MCP Tool Definitions — 52 tools.
 *
 * Tickets, Search, Users, Organizations, Groups, Workflow/config,
 * Satisfaction, and (read-only) Help Center. All calls target
 * {broker meta.baseUrl}/api/v2. [R]=read (GET), [W]=write.
 */

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (client: ZendeskClient, args: any) => Promise<any>;
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
];
