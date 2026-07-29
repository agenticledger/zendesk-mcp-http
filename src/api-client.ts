/**
 * Zendesk Support / Help Center API Client
 *
 * Base URL: {baseUrl}/api/v2  where baseUrl is the caller's Zendesk host
 *           (e.g. https://acme.zendesk.com), resolved by the Connections Broker
 *           from the stored connection's meta.baseUrl — NEVER hardcoded here.
 * Auth: OAuth 2.0 Bearer access token (resolved by the broker per request).
 * Pagination: cursor (page[size], page[after]) and legacy (per_page, page).
 */

type ParamValue = string | number | boolean | undefined;
type Params = Record<string, ParamValue>;

export class ZendeskClient {
  private accessToken: string;
  private apiBase: string;

  constructor(accessToken: string, baseUrl: string) {
    if (!accessToken) throw new Error('Zendesk access token is required');
    if (!baseUrl) throw new Error('Zendesk baseUrl is required (from broker meta.baseUrl)');
    this.accessToken = accessToken;
    // baseUrl is e.g. https://acme.zendesk.com — all calls hit {baseUrl}/api/v2/...
    this.apiBase = `${baseUrl.replace(/\/$/, '')}/api/v2`;
  }

  private async request<T>(
    endpoint: string,
    options: { method?: string; body?: any; params?: Params } = {}
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.apiBase}${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.append(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(url.toString(), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Zendesk API ${response.status}: ${text}`);
    }

    if (response.status === 204) return {} as T;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();
    return (await response.text()) as unknown as T;
  }

  /** Common list pagination/sort params, all optional. */
  private page(args: any = {}): Params {
    return {
      'page[size]': args.page_size,
      'page[after]': args.page_after,
      'page[before]': args.page_before,
      per_page: args.per_page,
      page: args.page,
      sort_by: args.sort_by,
      sort_order: args.sort_order,
    };
  }

  // ===================== TICKETS =====================
  async listTickets(args: any = {}) { return this.request<any>('/tickets', { params: this.page(args) }); }
  async getTicket(id: string) { return this.request<any>(`/tickets/${encodeURIComponent(id)}`); }
  async showManyTickets(ids: string) { return this.request<any>('/tickets/show_many', { params: { ids } }); }
  async createTicket(ticket: any) { return this.request<any>('/tickets', { method: 'POST', body: { ticket } }); }
  async updateTicket(id: string, ticket: any) { return this.request<any>(`/tickets/${encodeURIComponent(id)}`, { method: 'PUT', body: { ticket } }); }
  async deleteTicket(id: string) { return this.request<any>(`/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async mergeTicket(id: string, ids: number[], sourceComment?: string, targetComment?: string) {
    const body: any = { ids };
    if (sourceComment) body.source_comment = sourceComment;
    if (targetComment) body.target_comment = targetComment;
    return this.request<any>(`/tickets/${encodeURIComponent(id)}/merge`, { method: 'POST', body });
  }
  async addTicketComment(id: string, commentBody: string, isPublic = true) {
    return this.request<any>(`/tickets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { ticket: { comment: { body: commentBody, public: isPublic } } },
    });
  }
  async addTicketTags(id: string, tags: string[]) {
    return this.request<any>(`/tickets/${encodeURIComponent(id)}/tags`, { method: 'PUT', body: { tags } });
  }
  async listTicketComments(id: string, args: any = {}) { return this.request<any>(`/tickets/${encodeURIComponent(id)}/comments`, { params: this.page(args) }); }
  async listTicketAudits(id: string, args: any = {}) { return this.request<any>(`/tickets/${encodeURIComponent(id)}/audits`, { params: this.page(args) }); }
  async getTicketMetrics(id: string) { return this.request<any>(`/tickets/${encodeURIComponent(id)}/metrics`); }

  // ===================== SEARCH =====================
  async search(query: string, args: any = {}) { return this.request<any>('/search', { params: { query, ...this.page(args) } }); }
  async searchCount(query: string) { return this.request<any>('/search/count', { params: { query } }); }
  async incrementalTickets(startTime: number, args: any = {}) {
    return this.request<any>('/incremental/tickets', { params: { start_time: startTime, per_page: args.per_page } });
  }

  // ===================== USERS =====================
  async listUsers(args: any = {}) { return this.request<any>('/users', { params: { role: args.role, ...this.page(args) } }); }
  async getUser(id: string) { return this.request<any>(`/users/${encodeURIComponent(id)}`); }
  async searchUsers(query: string, args: any = {}) { return this.request<any>('/users/search', { params: { query, ...this.page(args) } }); }
  async getMe() { return this.request<any>('/users/me'); }
  async listUserIdentities(id: string, args: any = {}) { return this.request<any>(`/users/${encodeURIComponent(id)}/identities`, { params: this.page(args) }); }
  async getUserRelated(id: string) { return this.request<any>(`/users/${encodeURIComponent(id)}/related`); }
  async createUser(user: any) { return this.request<any>('/users', { method: 'POST', body: { user } }); }
  async updateUser(id: string, user: any) { return this.request<any>(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: { user } }); }
  async deleteUser(id: string) { return this.request<any>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== ORGANIZATIONS =====================
  async listOrganizations(args: any = {}) { return this.request<any>('/organizations', { params: this.page(args) }); }
  async getOrganization(id: string) { return this.request<any>(`/organizations/${encodeURIComponent(id)}`); }
  async searchOrganizations(name: string) { return this.request<any>('/organizations/search', { params: { name } }); }
  async listOrganizationMemberships(args: any = {}) {
    return this.request<any>('/organization_memberships', {
      params: { user_id: args.user_id, organization_id: args.organization_id, ...this.page(args) },
    });
  }
  async createOrganization(organization: any) { return this.request<any>('/organizations', { method: 'POST', body: { organization } }); }
  async updateOrganization(id: string, organization: any) { return this.request<any>(`/organizations/${encodeURIComponent(id)}`, { method: 'PUT', body: { organization } }); }
  async deleteOrganization(id: string) { return this.request<any>(`/organizations/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== GROUPS =====================
  async listGroups(args: any = {}) { return this.request<any>('/groups', { params: this.page(args) }); }
  async getGroup(id: string) { return this.request<any>(`/groups/${encodeURIComponent(id)}`); }
  async listGroupMemberships(args: any = {}) {
    return this.request<any>('/group_memberships', {
      params: { user_id: args.user_id, group_id: args.group_id, ...this.page(args) },
    });
  }

  // ===================== WORKFLOW / CONFIG (read) =====================
  async listViews(args: any = {}) { return this.request<any>('/views', { params: this.page(args) }); }
  async executeView(id: string, args: any = {}) { return this.request<any>(`/views/${encodeURIComponent(id)}/execute`, { params: this.page(args) }); }
  async listViewTickets(id: string, args: any = {}) { return this.request<any>(`/views/${encodeURIComponent(id)}/tickets`, { params: this.page(args) }); }
  async listMacros(args: any = {}) { return this.request<any>('/macros', { params: this.page(args) }); }
  async macroApplyPreview(id: string) { return this.request<any>(`/macros/${encodeURIComponent(id)}/apply`); }
  async listTriggers(args: any = {}) { return this.request<any>('/triggers', { params: this.page(args) }); }
  async listAutomations(args: any = {}) { return this.request<any>('/automations', { params: this.page(args) }); }
  async listTicketFields(args: any = {}) { return this.request<any>('/ticket_fields', { params: this.page(args) }); }
  async listTicketForms(args: any = {}) { return this.request<any>('/ticket_forms', { params: this.page(args) }); }
  async listSlaPolicies(args: any = {}) { return this.request<any>('/slas/policies', { params: this.page(args) }); }
  async listTags(args: any = {}) { return this.request<any>('/tags', { params: this.page(args) }); }

  // ===================== SATISFACTION =====================
  async listSatisfactionRatings(args: any = {}) {
    return this.request<any>('/satisfaction_ratings', {
      params: { score: args.score, start_time: args.start_time, end_time: args.end_time, ...this.page(args) },
    });
  }
  async createSatisfactionRating(ticketId: string, rating: any) {
    return this.request<any>(`/tickets/${encodeURIComponent(ticketId)}/satisfaction_rating`, {
      method: 'POST',
      body: { satisfaction_rating: rating },
    });
  }

  // ===================== HELP CENTER (read) =====================
  async listHcArticles(args: any = {}) { return this.request<any>('/help_center/articles', { params: { locale: args.locale, ...this.page(args) } }); }
  async getHcArticle(id: string) { return this.request<any>(`/help_center/articles/${encodeURIComponent(id)}`); }
  async searchHcArticles(query: string, args: any = {}) { return this.request<any>('/help_center/articles/search', { params: { query, locale: args.locale, ...this.page(args) } }); }
  async listHcSections(args: any = {}) { return this.request<any>('/help_center/sections', { params: { locale: args.locale, ...this.page(args) } }); }
  async listHcCategories(args: any = {}) { return this.request<any>('/help_center/categories', { params: { locale: args.locale, ...this.page(args) } }); }

  // ===================== GENERIC PASSTHROUGH =====================
  /**
   * Authenticated passthrough to ANY /api/v2 endpoint using the same broker OAuth
   * token. `path` may be given with or without a leading `/api/v2` (both normalise
   * to the caller's Zendesk host). Write-verb gating lives in the tool layer, not
   * here — this method performs exactly the request it is handed.
   */
  async raw(method: string, path: string, query?: Params, body?: any) {
    let endpoint = path.trim();
    endpoint = endpoint.replace(/^https?:\/\/[^/]+/i, '');       // tolerate a full URL
    endpoint = endpoint.replace(/^\/api\/v2/i, '');              // apiBase already ends in /api/v2
    if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;
    return this.request<any>(endpoint, { method: method.toUpperCase(), params: query, body });
  }

  // ===================== CONFIG: TICKET FIELDS =====================
  async getTicketField(id: string) { return this.request<any>(`/ticket_fields/${encodeURIComponent(id)}`); }
  async createTicketField(ticket_field: any) { return this.request<any>('/ticket_fields', { method: 'POST', body: { ticket_field } }); }
  async updateTicketField(id: string, ticket_field: any) { return this.request<any>(`/ticket_fields/${encodeURIComponent(id)}`, { method: 'PUT', body: { ticket_field } }); }
  async deleteTicketField(id: string) { return this.request<any>(`/ticket_fields/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== CONFIG: TICKET FORMS =====================
  async getTicketForm(id: string) { return this.request<any>(`/ticket_forms/${encodeURIComponent(id)}`); }
  async createTicketForm(ticket_form: any) { return this.request<any>('/ticket_forms', { method: 'POST', body: { ticket_form } }); }
  async updateTicketForm(id: string, ticket_form: any) { return this.request<any>(`/ticket_forms/${encodeURIComponent(id)}`, { method: 'PUT', body: { ticket_form } }); }
  async deleteTicketForm(id: string) { return this.request<any>(`/ticket_forms/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== CONFIG: GROUPS + MEMBERSHIPS =====================
  async createGroup(group: any) { return this.request<any>('/groups', { method: 'POST', body: { group } }); }
  async updateGroup(id: string, group: any) { return this.request<any>(`/groups/${encodeURIComponent(id)}`, { method: 'PUT', body: { group } }); }
  async deleteGroup(id: string) { return this.request<any>(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async createGroupMembership(group_membership: any) { return this.request<any>('/group_memberships', { method: 'POST', body: { group_membership } }); }
  async deleteGroupMembership(id: string) { return this.request<any>(`/group_memberships/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== CONFIG: SLA POLICIES =====================
  async getSlaPolicy(id: string) { return this.request<any>(`/slas/policies/${encodeURIComponent(id)}`); }
  async createSlaPolicy(sla_policy: any) { return this.request<any>('/slas/policies', { method: 'POST', body: { sla_policy } }); }
  async updateSlaPolicy(id: string, sla_policy: any) { return this.request<any>(`/slas/policies/${encodeURIComponent(id)}`, { method: 'PUT', body: { sla_policy } }); }
  async deleteSlaPolicy(id: string) { return this.request<any>(`/slas/policies/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== CONFIG: TRIGGERS + CATEGORIES =====================
  async getTrigger(id: string) { return this.request<any>(`/triggers/${encodeURIComponent(id)}`); }
  async createTrigger(trigger: any) { return this.request<any>('/triggers', { method: 'POST', body: { trigger } }); }
  async updateTrigger(id: string, trigger: any) { return this.request<any>(`/triggers/${encodeURIComponent(id)}`, { method: 'PUT', body: { trigger } }); }
  async deleteTrigger(id: string) { return this.request<any>(`/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async listTriggerCategories(args: any = {}) { return this.request<any>('/trigger_categories', { params: this.page(args) }); }
  async createTriggerCategory(trigger_category: any) { return this.request<any>('/trigger_categories', { method: 'POST', body: { trigger_category } }); }

  // ===================== CONFIG: AUTOMATIONS =====================
  async getAutomation(id: string) { return this.request<any>(`/automations/${encodeURIComponent(id)}`); }
  async createAutomation(automation: any) { return this.request<any>('/automations', { method: 'POST', body: { automation } }); }
  async updateAutomation(id: string, automation: any) { return this.request<any>(`/automations/${encodeURIComponent(id)}`, { method: 'PUT', body: { automation } }); }
  async deleteAutomation(id: string) { return this.request<any>(`/automations/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== CONFIG: BUSINESS-HOURS SCHEDULES =====================
  async listSchedules(args: any = {}) { return this.request<any>('/business_hours/schedules', { params: this.page(args) }); }
  async getSchedule(id: string) { return this.request<any>(`/business_hours/schedules/${encodeURIComponent(id)}`); }
  async createSchedule(schedule: any) { return this.request<any>('/business_hours/schedules', { method: 'POST', body: { schedule } }); }
  async updateSchedule(id: string, schedule: any) { return this.request<any>(`/business_hours/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: { schedule } }); }

  // ===================== CONFIG: CUSTOM STATUSES =====================
  async listCustomStatuses(args: any = {}) { return this.request<any>('/custom_statuses', { params: this.page(args) }); }
  async createCustomStatus(custom_status: any) { return this.request<any>('/custom_statuses', { method: 'POST', body: { custom_status } }); }
  async updateCustomStatus(id: string, custom_status: any) { return this.request<any>(`/custom_statuses/${encodeURIComponent(id)}`, { method: 'PUT', body: { custom_status } }); }

  // ===================== CONFIG: MACROS =====================
  async getMacro(id: string) { return this.request<any>(`/macros/${encodeURIComponent(id)}`); }
  async createMacro(macro: any) { return this.request<any>('/macros', { method: 'POST', body: { macro } }); }
  async updateMacro(id: string, macro: any) { return this.request<any>(`/macros/${encodeURIComponent(id)}`, { method: 'PUT', body: { macro } }); }
  async deleteMacro(id: string) { return this.request<any>(`/macros/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== CONFIG: VIEWS =====================
  async createView(view: any) { return this.request<any>('/views', { method: 'POST', body: { view } }); }
  async updateView(id: string, view: any) { return this.request<any>(`/views/${encodeURIComponent(id)}`, { method: 'PUT', body: { view } }); }
  async deleteView(id: string) { return this.request<any>(`/views/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  // ===================== HELP CENTER (write) =====================
  // locale is required by the HC write surface; it goes in the path.
  async createHcCategory(locale: string, category: any) { return this.request<any>(`/help_center/${encodeURIComponent(locale)}/categories`, { method: 'POST', body: { category } }); }
  async updateHcCategory(id: string, category: any) { return this.request<any>(`/help_center/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: { category } }); }
  async createHcSection(locale: string, categoryId: string, section: any) { return this.request<any>(`/help_center/${encodeURIComponent(locale)}/categories/${encodeURIComponent(categoryId)}/sections`, { method: 'POST', body: { section } }); }
  async updateHcSection(id: string, section: any) { return this.request<any>(`/help_center/sections/${encodeURIComponent(id)}`, { method: 'PUT', body: { section } }); }
  async createHcArticle(locale: string, sectionId: string, article: any) { return this.request<any>(`/help_center/${encodeURIComponent(locale)}/sections/${encodeURIComponent(sectionId)}/articles`, { method: 'POST', body: { article } }); }
  async updateHcArticle(id: string, article: any) { return this.request<any>(`/help_center/articles/${encodeURIComponent(id)}`, { method: 'PUT', body: { article } }); }
  async deleteHcArticle(id: string) { return this.request<any>(`/help_center/articles/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}
