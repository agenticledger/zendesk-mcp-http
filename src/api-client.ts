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
      'page[size]': args['page[size]'],
      'page[after]': args['page[after]'],
      'page[before]': args['page[before]'],
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
}
