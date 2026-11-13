import type {
  AuthResponse,
  AuthAccessContext,
  AuthUser,
  CreateMembershipRequest,
  CreateTenantRequest,
  CreateTenantApplicationRequest,
  PublicTenantApplicationRequest,
  CompleteTenantInvitationRequest,
  ClaimTenantInvitationRequest,
  LocationDto,
  LoginRequest,
  MembershipDto,
  RegisterRequest,
  TenantContextDto,
  TenantDto,
  TenantPolicyDto,
  UpdateLocationRequest,
  UpdateMembershipRequest,
  AvailabilitySlotDto,
  BookingCountPointDto,
  BookingRevenuePointDto,
  ServiceBookingCountDto,
  BookingDto,
  GuestSessionResponse,
  PublicBookingSummary,
  PublicServiceDto,
  PublicTenantPageDto,
  TenantThemeMode,
  PublicStaffDto,
  PublicCreateBookingRequest,
  GuestRescheduleRequest,
  UpdateTenantPolicyRequest,
  UpdateTenantRequest,
  UpdateTenantThemeRequest,
  CreateScheduleExceptionRequest,
  CreateStaffShiftTemplateRequest,
  CreateServiceRequest,
  CreateStaffRequest,
  ScheduleExceptionDto,
  ServiceDto,
  StaffDto,
  StaffShiftTemplateDto,
  UpdateServiceRequest,
  UpdateStaffRequest,
  UpdateStaffShiftTemplateRequest,
  WorkingHourDto,
  WorkingHoursRequest,
  WeeklyWorkingHoursRequest,
  PlatformAdminBootstrapRequest,
  PlatformAdminBootstrapResponse,
  PlatformAdminBootstrapStatus,
  PlatformSettingsStatus,
  PlatformSettingsTestResult,
  PlatformTenantDto,
  PlatformTenantDetailDto,
  PlatformNotificationDto,
  TenantNotificationPageDto,
  TenantApplicationDto,
  ReviewTenantApplicationRequest,
  UpdateTenantStatusRequest,
  UpdatePlatformSettingsRequest,
  TestPlatformSettingsRequest,
  UnlockPlatformSettingsRequest,
  BillingCheckoutRequest,
  BillingCheckoutResponse,
  BillingOrderDto,
  PlanDto,
  TenantBillingDto,
  PlatformPlanDto,
  UpsertPlanRequest,
  AssignTenantPlanRequest,
  PlatformBillingFilters,
  PlatformBillingOrderDto,
  PlatformBillingOrderPageDto,
  PlatformBillingReconciliationDto,
  PlatformBillingSubscriptionPageDto,
  PlatformBillingSummaryDto,
  PlatformBillingRefundDto,
  ReconcileRefundDto,
  ReconcileRefundRequest,
  RefundPaymentRequest,
  ApplyLatePaymentRequest,
  TenantTelegramIntegrationDto,
  TelegramPairingCodeDto,
  TelegramGroupDiscoveryDto,
  ConfirmTelegramGroupRequest,
  TelegramIntegrationTestDto,
  SaveTenantTelegramIntegrationRequest,
  CreateSupportMessageRequest,
  CreateSupportTicketRequest,
  SupportTicketDto,
  UpdateSupportTicketStatusRequest,
} from '@sbc/contracts';
export type TenantTelegramIntegrationStatus = TenantTelegramIntegrationDto;
export type TenantTelegramLinkCode = TelegramPairingCodeDto;
export type TenantTelegramGroupCandidates = TelegramGroupDiscoveryDto;

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8002';

type NotificationStreamStatus = 'connecting' | 'connected' | 'reconnecting';

let lastUserActivityAt = 0;
let activityListenersReady = false;
let refreshInFlight: Promise<boolean> | null = null;

function userWasRecentlyActive(): boolean {
  if (typeof window === 'undefined') return false;
  if (!activityListenersReady) {
    activityListenersReady = true;
    const markActive = () => { lastUserActivityAt = Date.now(); };
    window.addEventListener('pointerdown', markActive, { passive: true });
    window.addEventListener('pointermove', markActive, { passive: true });
    window.addEventListener('keydown', markActive);
    window.addEventListener('touchstart', markActive, { passive: true });
    window.addEventListener('wheel', markActive, { passive: true });
  }
  return lastUserActivityAt > 0 && Date.now() - lastUserActivityAt <= 5 * 60_000;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    const performRefresh = async () => fetch(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-sbc-request': '1', 'x-sbc-user-active': userWasRecentlyActive() ? '1' : '0' },
      }).then((response) => response.ok).catch(() => false);
    const locks = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> } }).locks
      : undefined;
    const coordinated = locks ? locks.request('sbc-auth-refresh', performRefresh) : performRefresh();
    refreshInFlight = coordinated.finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function request<T>(
  endpoint: string,
  options: {
    method?: string;
    tenantId?: string | null;
    body?: unknown;
    extraHeaders?: Record<string, string>;
    retryAfterRefresh?: boolean;
  } = {},
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-sbc-request': '1',
    'x-sbc-user-active': userWasRecentlyActive() ? '1' : '0',
  };

  if (options.tenantId) {
    headers['x-tenant-id'] = options.tenantId;
  }
  Object.assign(headers, options.extraHeaders || {});

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  const isAuthEndpoint = ['/v1/auth/login', '/v1/auth/register', '/v1/auth/refresh', '/v1/auth/logout'].includes(endpoint);
  if (response.status === 401 && !isAuthEndpoint && options.retryAfterRefresh !== false && await refreshSession()) {
    return request<T>(endpoint, { ...options, retryAfterRefresh: false });
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function connectNotificationStream(
  path: string,
  tenantId: string | undefined,
  onSignal: () => void,
  onStatus?: (status: NotificationStreamStatus) => void,
): () => void {
  const controller = new AbortController();
  let stopped = false;
  let retryDelay = 500;

  const connect = async () => {
    while (!stopped) {
      onStatus?.(retryDelay === 500 ? 'connecting' : 'reconnecting');
      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          headers: {
            Accept: 'text/event-stream',
            'x-sbc-request': '1',
            'x-sbc-user-active': userWasRecentlyActive() ? '1' : '0',
            ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
          },
          signal: controller.signal,
        });
        if (response.status === 401 && await refreshSession()) continue;
        if (!response.ok || !response.body) throw new Error(`Notification stream returned ${response.status}`);

        retryDelay = 500;
        onStatus?.('connected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamEnded = false;
        while (!stopped && !streamEnded) {
          const { value, done } = await reader.read();
          streamEnded = done;
          if (value) buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventType = 'message';
            let hasData = false;
            for (const line of frame.split('\n')) {
              if (line.startsWith(':')) continue;
              const separator = line.indexOf(':');
              const field = separator < 0 ? line : line.slice(0, separator);
              const content = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
              if (field === 'event') eventType = content;
              if (field === 'data') hasData = true;
            }
            if (eventType === 'notification' && hasData) onSignal();
            boundary = buffer.indexOf('\n\n');
          }
        }
        await reader.cancel().catch(() => undefined);
        if (!stopped) onStatus?.('reconnecting');
      } catch {
        if (stopped || controller.signal.aborted) break;
        onStatus?.('reconnecting');
      }

      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 10_000);
    }
  };

  void connect();
  return () => {
    stopped = true;
    controller.abort();
  };
}

function connectPlatformNotificationStream(onSignal: () => void, onStatus?: (status: NotificationStreamStatus) => void): () => void {
  return connectNotificationStream('/v1/platform/notifications/stream', undefined, onSignal, onStatus);
}

function billingQuery(filters: PlatformBillingFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

export const api = {
  // Auth
  register: (dto: RegisterRequest) =>
    request<AuthResponse>('/v1/auth/register', { method: 'POST', body: dto }),

  login: (dto: LoginRequest) =>
    request<AuthResponse>('/v1/auth/login', { method: 'POST', body: dto }),

  logout: () => request<void>('/v1/auth/logout', { method: 'POST' }),

  getMe: () => request<AuthUser>('/v1/auth/me'),

  getAuthAccess: () => request<AuthAccessContext>('/v1/auth/access'),

  // Platform-only secret configuration. Returned data contains safe metadata only.
  platformBootstrapStatus: () =>
    request<PlatformAdminBootstrapStatus>('/v1/platform-settings/bootstrap-status'),
  bootstrapPlatformAdmin: (bootstrapToken: string) =>
    request<PlatformAdminBootstrapResponse>('/v1/platform-settings/bootstrap', {
      method: 'POST', body: { token: bootstrapToken } satisfies PlatformAdminBootstrapRequest,
    }),
  getPlatformSettings: () => request<PlatformSettingsStatus>('/v1/platform-settings'),
  unlockPlatformSettings: (dto: UnlockPlatformSettingsRequest) =>
    request<{ unlocked: true }>('/v1/platform-settings/unlock', { method: 'POST', body: dto }),
  updatePlatformSettings: (dto: UpdatePlatformSettingsRequest) =>
    request<PlatformSettingsStatus>('/v1/platform-settings', { method: 'PUT', body: dto }),
  testPlatformSettings: (dto: TestPlatformSettingsRequest) =>
    request<PlatformSettingsTestResult>('/v1/platform-settings/test', { method: 'POST', body: dto }),

  // Tenant billing uses server-side prices and requires an owner membership for checkout.
  listPlans: (tenantId: string) => request<PlanDto[]>('/v1/billing/plans', { tenantId }),
  currentBilling: (tenantId: string) => request<TenantBillingDto>('/v1/billing/current', { tenantId }),
  createBillingCheckout: (tenantId: string, dto: BillingCheckoutRequest) => request<BillingCheckoutResponse>('/v1/billing/checkout', { method: 'POST', tenantId, body: dto }),
  listBillingOrders: (tenantId: string) => request<BillingOrderDto[]>('/v1/billing/orders', { tenantId }),
  getBillingOrder: (tenantId: string, orderId: string) => request<BillingOrderDto>(`/v1/billing/orders/${encodeURIComponent(orderId)}`, { tenantId }),
  listSupportTickets: (tenantId: string) => request<SupportTicketDto[]>('/v1/support/tickets', { tenantId }),
  getSupportTicket: (tenantId: string, ticketId: string) => request<SupportTicketDto>(`/v1/support/tickets/${encodeURIComponent(ticketId)}`, { tenantId }),
  createSupportTicket: (tenantId: string, body: CreateSupportTicketRequest) => request<SupportTicketDto>('/v1/support/tickets', { method: 'POST', tenantId, body }),
  replySupportTicket: (tenantId: string, ticketId: string, body: CreateSupportMessageRequest) => request<SupportTicketDto>(`/v1/support/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', tenantId, body }),

  // Tenants
  createTenant: (dto: CreateTenantRequest) =>
    request<{
      tenant: TenantDto;
      location: LocationDto;
      policy: TenantPolicyDto;
    }>('/v1/tenants', { method: 'POST', body: dto }),

  listTenants: () =>
    request<
      Array<{
        tenant: TenantDto;
        role: string;
        status: string;
      }>
    >('/v1/tenants'),

  submitTenantApplication: (dto: CreateTenantApplicationRequest) =>
    request<TenantApplicationDto>('/v1/tenant-applications', { method: 'POST', body: dto }),
  submitPublicTenantApplication: (dto: PublicTenantApplicationRequest) =>
    request<{ accepted: true }>('/v1/tenant-applications/public', { method: 'POST', body: dto }),
  completeTenantInvitation: (dto: CompleteTenantInvitationRequest) =>
    request<{ completed: true }>('/v1/tenant-applications/complete-invitation', { method: 'POST', body: dto }),
  claimTenantInvitation: (dto: ClaimTenantInvitationRequest) =>
    request<{ completed: true; tenantId: string }>('/v1/tenant-applications/claim-invitation', { method: 'POST', body: dto }),
  myTenantApplication: () => request<TenantApplicationDto | null>('/v1/tenant-applications/mine'),
  listPlatformTenants: () => request<PlatformTenantDto[]>('/v1/platform/tenants'),
  getPlatformTenantDetail: (tenantId: string) => request<PlatformTenantDetailDto>(`/v1/platform/tenants/${tenantId}`),
  listPlatformPlans: () => request<PlatformPlanDto[]>('/v1/platform/plans'),
  listPublicPlans: () => request<PlanDto[]>('/v1/billing/catalog'),
  createPlatformPlanVersion: (body: UpsertPlanRequest) => request<PlatformPlanDto>('/v1/platform/plans', { method: 'POST', body }),
  archivePlatformPlan: (planId: string) => request<PlatformPlanDto>(`/v1/platform/plans/${planId}/archive`, { method: 'PATCH' }),
  getPlatformBillingSummary: (from?: string, to?: string) => request<PlatformBillingSummaryDto>(`/v1/platform/billing/summary?${billingQuery({ from, to })}`),
  listPlatformBillingSubscriptions: (filters: PlatformBillingFilters) => request<PlatformBillingSubscriptionPageDto>(`/v1/platform/billing/subscriptions?${billingQuery(filters)}`),
  listPlatformBillingOrders: (filters: PlatformBillingFilters) => request<PlatformBillingOrderPageDto>(`/v1/platform/billing/orders?${billingQuery(filters)}`),
  listPlatformBillingReconciliationOrders: (filters: PlatformBillingFilters) => request<PlatformBillingOrderDto[]>(`/v1/platform/billing/reconciliation-needed?${billingQuery(filters)}`),
  reconcilePlatformBillingOrder: (orderId: string) => request<PlatformBillingReconciliationDto>(`/v1/platform/billing/orders/${encodeURIComponent(orderId)}/reconcile`, { method: 'POST' }),
  refundPlatformBillingOrder: (orderId: string, body: RefundPaymentRequest) => request<PlatformBillingRefundDto>(`/v1/platform/billing/orders/${encodeURIComponent(orderId)}/refund`, { method: 'POST', body }),
  reconcilePlatformBillingRefund: (orderId: string, refundId: string, body: ReconcileRefundRequest) => request<ReconcileRefundDto>(`/v1/platform/billing/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}/reconcile`, { method: 'POST', body }),
  applyPlatformLatePayment: (orderId: string, body: ApplyLatePaymentRequest) => request<void>(`/v1/platform/billing/orders/${encodeURIComponent(orderId)}/apply-late-payment`, { method: 'POST', body }),
  listPlatformSupportTickets: (status = 'all', search = '') => request<SupportTicketDto[]>(`/v1/platform/support/tickets?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`),
  getPlatformSupportTicket: (ticketId: string) => request<SupportTicketDto>(`/v1/platform/support/tickets/${encodeURIComponent(ticketId)}`),
  replyPlatformSupportTicket: (ticketId: string, body: CreateSupportMessageRequest) => request<SupportTicketDto>(`/v1/platform/support/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', body }),
  updatePlatformSupportTicket: (ticketId: string, body: UpdateSupportTicketStatusRequest) => request<SupportTicketDto>(`/v1/platform/support/tickets/${encodeURIComponent(ticketId)}/status`, { method: 'PATCH', body }),
  assignPlatformTenantPlan: (tenantId: string, body: AssignTenantPlanRequest) => request<void>(`/v1/platform/tenants/${tenantId}/plan`, { method: 'PATCH', body }),
  listPlatformNotifications: () => request<PlatformNotificationDto[]>('/v1/platform/notifications'),
  connectPlatformNotificationStream,
  markPlatformNotificationRead: (notificationId: string) =>
    request<{ read: true }>(`/v1/platform/notifications/${notificationId}/read`, { method: 'PATCH' }),
  listTenantNotifications: (tenantId: string, page = 1) =>
    request<TenantNotificationPageDto>(`/v1/notifications?page=${page}`, { tenantId }),
  connectTenantNotificationStream: (tenantId: string, onSignal: () => void, onStatus?: (status: NotificationStreamStatus) => void) =>
    connectNotificationStream('/v1/notifications/stream', tenantId, onSignal, onStatus),
  markTenantNotificationRead: (tenantId: string, notificationId: string) =>
    request<{ read: true }>(`/v1/notifications/${notificationId}/read`, { method: 'PATCH', tenantId }),
  markAllTenantNotificationsRead: (tenantId: string) =>
    request<{ read: true }>('/v1/notifications/read-all', { method: 'PATCH', tenantId }),
  getTenantTelegramIntegration: (tenantId: string) =>
    request<TenantTelegramIntegrationStatus>('/v1/integrations/telegram', { tenantId }),
  saveTenantTelegramIntegration: (tenantId: string, body: SaveTenantTelegramIntegrationRequest) =>
    request<TenantTelegramIntegrationStatus>('/v1/integrations/telegram', { method: 'PUT', tenantId, body }),
  createTenantTelegramLinkCode: (tenantId: string) =>
    request<TenantTelegramLinkCode>('/v1/integrations/telegram/link-code', { method: 'POST', tenantId }),
  discoverTenantTelegramGroups: (tenantId: string) =>
    request<TenantTelegramGroupCandidates>('/v1/integrations/telegram/discover', { method: 'POST', tenantId }),
  confirmTenantTelegramGroup: (tenantId: string, body: ConfirmTelegramGroupRequest) =>
    request<TenantTelegramIntegrationStatus>('/v1/integrations/telegram/confirm', { method: 'POST', tenantId, body }),
  testTenantTelegramIntegration: (tenantId: string) =>
    request<TelegramIntegrationTestDto>('/v1/integrations/telegram/test', { method: 'POST', tenantId }),
  setTenantTelegramEnabled: (tenantId: string, enabled: boolean) =>
    request<TenantTelegramIntegrationStatus>('/v1/integrations/telegram/enabled', { method: 'PATCH', tenantId, body: { enabled } }),
  updatePlatformTenantStatus: (tenantId: string, dto: UpdateTenantStatusRequest) =>
    request<PlatformTenantDto>(`/v1/platform/tenants/${tenantId}/status`, { method: 'PATCH', body: dto }),
  listTenantApplications: () => request<TenantApplicationDto[]>('/v1/platform/tenant-applications'),
  reviewTenantApplication: (applicationId: string, dto: ReviewTenantApplicationRequest) =>
    request<TenantApplicationDto>(`/v1/platform/tenant-applications/${applicationId}/review`, { method: 'PATCH', body: dto }),

  getCurrentTenant: (tenantId: string) => request<TenantContextDto>('/v1/tenants/current', { tenantId }),
  updateCurrentTenantTheme: (tenantId: string, dto: UpdateTenantThemeRequest) =>
    request<{ themeKey: string | null; themeMode: TenantThemeMode }>('/v1/tenants/current/theme', { method: 'PATCH', tenantId, body: dto }),

  updateTenant: (tenantId: string, dto: UpdateTenantRequest) =>
    request<TenantDto>('/v1/tenants/current', {
      method: 'PATCH',
      tenantId,
      body: dto,
    }),

  // Policies
  getPolicies: (tenantId: string) => request<TenantPolicyDto>('/v1/tenant-policies', { tenantId }),

  updatePolicies: (
    tenantId: string,
    dto: UpdateTenantPolicyRequest,
  ) =>
    request<TenantPolicyDto>('/v1/tenant-policies', {
      method: 'PUT',
      tenantId,
      body: dto,
    }),

  // Locations
  getCurrentLocation: (tenantId: string) => request<LocationDto>('/v1/locations/current', { tenantId }),

  updateLocation: (
    tenantId: string,
    dto: UpdateLocationRequest,
  ) =>
    request<LocationDto>('/v1/locations/current', {
      method: 'PATCH',
      tenantId,
      body: dto,
    }),

  // Memberships
  listMembers: (tenantId: string) => request<MembershipDto[]>('/v1/memberships', { tenantId }),

  addMember: (tenantId: string, dto: CreateMembershipRequest) =>
    request<MembershipDto>('/v1/memberships', {
      method: 'POST',
      tenantId,
      body: dto,
    }),

  updateMember: (
    tenantId: string,
    membershipId: string,
    dto: UpdateMembershipRequest,
  ) =>
    request<MembershipDto>(`/v1/memberships/${membershipId}`, {
      method: 'PATCH',
      tenantId,
      body: dto,
    }),

  removeMember: (tenantId: string, membershipId: string) =>
    request<{ success: boolean }>(`/v1/memberships/${membershipId}`, {
      method: 'DELETE',
      tenantId,
    }),

  // Catalog and staff
  listServices: (tenantId: string) => request<ServiceDto[]>('/v1/catalog/services', { tenantId }),
  createService: (tenantId: string, dto: CreateServiceRequest) => request<ServiceDto>('/v1/catalog/services', { method: 'POST', tenantId, body: dto }),
  updateService: (tenantId: string, id: string, dto: UpdateServiceRequest) => request<ServiceDto>(`/v1/catalog/services/${id}`, { method: 'PATCH', tenantId, body: dto }),
  listStaff: (tenantId: string) => request<StaffDto[]>('/v1/catalog/staff', { tenantId }),
  createStaff: (tenantId: string, dto: CreateStaffRequest) => request<StaffDto>('/v1/catalog/staff', { method: 'POST', tenantId, body: dto }),
  updateStaff: (tenantId: string, id: string, dto: UpdateStaffRequest) => request<StaffDto>(`/v1/catalog/staff/${id}`, { method: 'PATCH', tenantId, body: dto }),

  // Working hours and exceptions
  listBusinessHours: (tenantId: string) => request<WorkingHourDto[]>('/v1/scheduling/business-hours', { tenantId }),
  setBusinessHours: (tenantId: string, weekday: number, dto: Omit<WorkingHoursRequest, 'weekday'>) => request<WorkingHourDto[]>(`/v1/scheduling/business-hours/${weekday}`, { method: 'PUT', tenantId, body: dto }),
  setBusinessHoursWeek: (tenantId: string, dto: WeeklyWorkingHoursRequest) => request<WorkingHourDto[]>('/v1/scheduling/business-hours/week', { method: 'PUT', tenantId, body: dto }),
  listStaffHours: (tenantId: string, staffId: string) => request<WorkingHourDto[]>(`/v1/scheduling/staff/${staffId}/hours`, { tenantId }),
  setStaffHours: (tenantId: string, staffId: string, weekday: number, dto: Omit<WorkingHoursRequest, 'weekday'>) => request<WorkingHourDto[]>(`/v1/scheduling/staff/${staffId}/hours/${weekday}`, { method: 'PUT', tenantId, body: dto }),
  listStaffShiftTemplates: (tenantId: string) => request<StaffShiftTemplateDto[]>('/v1/scheduling/staff-shifts', { tenantId }),
  createStaffShiftTemplate: (tenantId: string, dto: CreateStaffShiftTemplateRequest) => request<StaffShiftTemplateDto>('/v1/scheduling/staff-shifts', { method: 'POST', tenantId, body: dto }),
  updateStaffShiftTemplate: (tenantId: string, id: string, dto: UpdateStaffShiftTemplateRequest) => request<StaffShiftTemplateDto>(`/v1/scheduling/staff-shifts/${id}`, { method: 'PATCH', tenantId, body: dto }),
  listScheduleExceptions: (tenantId: string) => request<ScheduleExceptionDto[]>('/v1/scheduling/exceptions', { tenantId }),
  createScheduleException: (tenantId: string, dto: CreateScheduleExceptionRequest) => request<ScheduleExceptionDto>('/v1/scheduling/exceptions', { method: 'POST', tenantId, body: dto }),
  deactivateScheduleException: (tenantId: string, id: string) => request<ScheduleExceptionDto>(`/v1/scheduling/exceptions/${id}/deactivate`, { method: 'PATCH', tenantId }),

  // Public booking and guest self-service
  publicServices: (slug: string) => request<PublicServiceDto[]>(`/v1/public/${encodeURIComponent(slug)}/services`),
  publicTenantPage: (slug: string) => request<PublicTenantPageDto>(`/v1/public/${encodeURIComponent(slug)}/page`),
  publicStaff: (slug: string, serviceId: string) =>
    request<PublicStaffDto[]>(`/v1/public/${encodeURIComponent(slug)}/services/${encodeURIComponent(serviceId)}/staff`),
  publicAvailability: (slug: string, serviceIds: string[], date: string, staffId?: string) => {
    const query = new URLSearchParams({ serviceId: serviceIds[0], serviceIds: serviceIds.join(','), date });
    if (staffId) query.set('staffId', staffId);
    return request<AvailabilitySlotDto[]>(`/v1/public/${encodeURIComponent(slug)}/availability?${query}`);
  },
  publicBookingSuggestions: (slug: string, serviceIds: string[], date: string, staffByService: Record<string, string>) => {
    const query = new URLSearchParams({ serviceIds: serviceIds.join(','), date, staffByService: JSON.stringify(staffByService) });
    return request<import('@sbc/contracts').BookingScheduleSuggestionDto[]>(`/v1/public/${encodeURIComponent(slug)}/availability/suggestions?${query}`);
  },
  createPublicBooking: (slug: string, dto: PublicCreateBookingRequest, idempotencyKey: string) =>
    request<PublicBookingSummary>(`/v1/public/${encodeURIComponent(slug)}/bookings`, { method: 'POST', body: dto, extraHeaders: { 'idempotency-key': idempotencyKey } }),
  recoverPublicBooking: (slug: string, idempotencyKey: string, contact: string) =>
    request<{ found: false } | { found: true; booking: PublicBookingSummary; timezone: string }>(`/v1/public/${encodeURIComponent(slug)}/bookings/recover`, { method: 'POST', body: { idempotencyKey, contact } }),
  requestGuestLink: (slug: string, dto: { bookingId: string; email: string }) =>
    request<{ accepted: true }>(`/v1/public/${encodeURIComponent(slug)}/guest-access/request-link`, { method: 'POST', body: dto }),
  redeemGuestToken: (slug: string, token: string) =>
    request<GuestSessionResponse>(`/v1/public/${encodeURIComponent(slug)}/guest-access/redeem`, { method: 'POST', body: { token } }),
  guestBooking: (slug: string, bookingId: string, accessToken: string) =>
    request<PublicBookingSummary>(`/v1/public/${encodeURIComponent(slug)}/bookings/${bookingId}/manage`, { extraHeaders: { authorization: `Guest ${accessToken}` } }),
  cancelGuestBooking: (slug: string, bookingId: string, accessToken: string, idempotencyKey: string) =>
    request<PublicBookingSummary>(`/v1/public/${encodeURIComponent(slug)}/bookings/${bookingId}/cancel`, { method: 'POST', extraHeaders: { authorization: `Guest ${accessToken}`, 'idempotency-key': idempotencyKey } }),
  rescheduleGuestBooking: (slug: string, bookingId: string, accessToken: string, idempotencyKey: string, dto: GuestRescheduleRequest) =>
    request<PublicBookingSummary>(`/v1/public/${encodeURIComponent(slug)}/bookings/${bookingId}/reschedule`, { method: 'POST', body: dto, extraHeaders: { authorization: `Guest ${accessToken}`, 'idempotency-key': idempotencyKey } }),

  // Business booking calendar and lifecycle
  listBookings: (tenantId: string, from: string, to: string) => {
    const query = new URLSearchParams({ from, to });
    return request<BookingDto[]>(`/v1/bookings?${query}`, { tenantId });
  },
  bookingCounts: (tenantId: string, from: string, to: string) => {
    const query = new URLSearchParams({ from, to });
    return request<BookingCountPointDto[]>(`/v1/bookings/analytics/counts?${query}`, { tenantId });
  },
  serviceBookingCounts: (tenantId: string, from: string, to: string) => {
    const query = new URLSearchParams({ from, to });
    return request<ServiceBookingCountDto[]>(`/v1/bookings/analytics/services?${query}`, { tenantId });
  },
  bookingRevenue: (tenantId: string, from: string, to: string) => {
    const query = new URLSearchParams({ from, to });
    return request<BookingRevenuePointDto[]>(`/v1/bookings/analytics/revenue?${query}`, { tenantId });
  },
  bookingAvailability: (tenantId: string, serviceId: string, date: string, staffId?: string) => {
    const query = new URLSearchParams({ serviceId, date });
    if (staffId) query.set('staffId', staffId);
    return request<AvailabilitySlotDto[]>(`/v1/bookings/availability?${query}`, { tenantId });
  },
  bookingAction: (tenantId: string, bookingId: string, action: 'approve' | 'cancel' | 'complete' | 'no-show') =>
    request<BookingDto>(`/v1/bookings/${bookingId}/${action}`, { method: 'POST', tenantId, extraHeaders: { 'idempotency-key': crypto.randomUUID() } }),
  rescheduleBooking: (tenantId: string, bookingId: string, dto: GuestRescheduleRequest) =>
    request<BookingDto>(`/v1/bookings/${bookingId}/reschedule`, { method: 'POST', tenantId, body: dto, extraHeaders: { 'idempotency-key': crypto.randomUUID() } }),
};
