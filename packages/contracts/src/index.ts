export type MembershipRole = "owner" | "admin" | "receptionist" | "staff";
export type MembershipStatus = "active" | "invited" | "suspended";
export type TenantStatus = "active" | "suspended";
export type ConfirmationMode = "AUTO" | "MANUAL";
export type TenantThemeKey =
  | "blueberry-cream"
  | "peach-soda"
  | "matcha-latte"
  | "lavender-pop"
  | "strawberry-milk"
  | "minty-fresh"
  | "coral-bloom"
  | "lemon-sorbet"
  | "cotton-candy";

export interface UpdateTenantThemeRequest {
  themeKey: TenantThemeKey | null;
  themeMode: TenantThemeMode;
}

export type TenantThemeMode = "light" | "dark";

export interface PublicTenantPageDto {
  slug: string;
  displayName: string;
  themeKey: TenantThemeKey | null;
  themeMode: TenantThemeMode;
}

export interface HealthResponse {
  status: "ok";
  service: "api";
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthResponse {
  user: AuthUser;
}

export interface AuthAccessContext {
  platformAdmin: boolean;
}

export interface CreateTenantRequest {
  name: string;
  slug: string;
  timezone?: string;
  currency?: string;
}

export interface UpdateTenantRequest {
  displayName?: string;
  slug?: string;
}

export interface TenantDto {
  id: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export type TenantApplicationStatus = "pending" | "approved" | "rejected";

export type CreateTenantApplicationRequest = CreateTenantRequest;

export interface PublicTenantApplicationRequest {
  applicantName: string;
  applicantEmail: string;
  contactPhone: string;
  name: string;
  serviceType: string;
  requestedPlan: string;
}

export interface CompleteTenantInvitationRequest {
  token: string;
  password: string;
}

export interface ClaimTenantInvitationRequest {
  token: string;
}

export interface TenantApplicationDto {
  id: string;
  applicantUserId: string | null;
  applicantName: string;
  applicantEmail: string;
  contactPhone: string;
  serviceType: string;
  requestedPlan: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  status: TenantApplicationStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTenantApplicationRequest {
  decision: "approve" | "reject";
  note?: string;
}

export interface PlatformTenantDto extends TenantDto {
  ownerName: string | null;
  ownerEmail: string | null;
}

export interface PlatformTenantDetailDto extends PlatformTenantDto {
  locationName: string | null;
  timezone: string | null;
  currency: string | null;
  staffProfileCount: number;
  serviceCount: number;
  bookingCount: number;
  billing: {
    plan: PlanDto;
    status: 'active' | 'past_due' | 'expired';
    periodStart: string;
    periodEnd: string;
    usage: { activeStaff: number; bookings: number; bookingLimit: number | null };
  } | null;
  planChanges: Array<{ fromPlan: string | null; toPlan: string; note: string; changedAt: string }>;
  staffProfiles: Array<{ name: string; active: boolean }>;
  services: Array<{ name: string; durationMinutes: number; priceMinor: number; currency: string; active: boolean }>;
}

export type PlatformNotificationType = "tenant_application_submitted" | "tenant_application_reviewed";

export interface TenantNotificationDto {
  id: string;
  type: string;
  title: string;
  description: string;
  actionPath: string;
  occurredAt: string;
  isRead: boolean;
}

export interface TenantNotificationPageDto {
  items: TenantNotificationDto[];
  unreadCount: number;
  hasMore: boolean;
}

export type TenantTelegramIntegrationStatus = 'not_configured' | 'saved' | 'verified' | 'failed';
export type TelegramGroupType = 'group' | 'supergroup';

export interface TenantTelegramIntegrationDto {
  configured: boolean;
  enabled: boolean;
  status: TenantTelegramIntegrationStatus;
  botUsername: string | null;
  group: { chatId: string; title: string | null; type: TelegramGroupType } | null;
  lastCheckedAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: 'sent' | 'failed' | null;
  lastDeliveryErrorCode: string | null;
  pairingExpiresAt: string | null;
}

export interface SaveTenantTelegramIntegrationRequest {
  botToken?: string;
  enabled?: boolean;
}

export interface TelegramPairingCodeDto {
  code: string;
  commandText: string;
  expiresAt: string;
}

export interface TelegramGroupCandidateDto {
  chatId: string;
  title: string | null;
  type: TelegramGroupType;
}

export interface TelegramGroupDiscoveryDto {
  candidates: TelegramGroupCandidateDto[];
  pairingExpiresAt: string;
}

export interface ConfirmTelegramGroupRequest {
  chatId: string;
}

export interface TelegramIntegrationTestDto {
  verified: boolean;
  botUsername: string;
  groupTitle: string | null;
  checkedAt: string;
}

export interface PlatformNotificationDto {
  id: string;
  type: PlatformNotificationType;
  title: string;
  description: string;
  occurredAt: string;
  isRead: boolean;
  tenantId: string | null;
  applicationId: string | null;
}

export interface UpdateTenantStatusRequest {
  status: TenantStatus;
}

export interface LocationDto {
  id: string;
  tenantId: string;
  name: string;
  timezone: string;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateLocationRequest {
  name?: string;
  timezone?: string;
  currency?: string;
}

export interface TenantPolicyDto {
  tenantId: string;
  confirmationMode: ConfirmationMode;
  pendingExpiryMinutes: number;
  cancellationCutoffMinutes: number;
  rescheduleCutoffMinutes: number;
  minLeadMinutes: number;
  bookingHorizonDays: number;
  slotIntervalMinutes: number;
    appointmentReminderMinutes: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateTenantPolicyRequest {
  confirmationMode?: ConfirmationMode;
  pendingExpiryMinutes?: number;
  cancellationCutoffMinutes?: number;
  rescheduleCutoffMinutes?: number;
  minLeadMinutes?: number;
  bookingHorizonDays?: number;
  slotIntervalMinutes?: number;
  appointmentReminderMinutes?: number | null;
}

export interface ServiceDto {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  currency: string;
  active: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceRequest {
  name: string;
  description?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  priceMinor: number;
  currency?: string;
  active?: boolean;
  published?: boolean;
}

export type UpdateServiceRequest = Partial<CreateServiceRequest>;

export interface StaffDto {
  id: string;
  tenantId: string;
  locationId: string;
  userId: string | null;
  name: string;
  active: boolean;
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffRequest {
  name: string;
  userId?: string | null;
  active?: boolean;
  serviceIds?: string[];
}

export type UpdateStaffRequest = Partial<CreateStaffRequest>;

export interface WorkingHourDto {
  id: string;
  tenantId: string;
  weekday: number;
  localStart: string;
  localEnd: string;
}

export interface WorkingHoursRequest {
  weekday: number;
  intervals: Array<{ localStart: string; localEnd: string }>;
}

export interface StaffShiftTemplateDto {
  id: string;
  tenantId: string;
  name: string;
  intervals: Array<{ localStart: string; localEnd: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffShiftTemplateRequest {
  name: string;
  intervals: Array<{ localStart: string; localEnd: string }>;
}

export type UpdateStaffShiftTemplateRequest = CreateStaffShiftTemplateRequest;

export interface WeeklyWorkingHoursRequest {
  days: WorkingHoursRequest[];
}

export interface ScheduleExceptionDto {
  id: string;
  tenantId: string;
  scope: "location" | "staff";
  locationId: string | null;
  staffId: string | null;
  onDate: string;
  localStart: string;
  localEnd: string;
  kind: "unavailable" | "available";
  reason: string | null;
  active: boolean;
  createdAt: string;
}

export interface CreateScheduleExceptionRequest {
  scope: "location" | "staff";
  staffId?: string;
  onDate: string;
  localStart: string;
  localEnd: string;
  kind: "unavailable" | "available";
  reason?: string;
}

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "COMPLETED" | "NO_SHOW";
export type StaffSelection = "SPECIFIC" | "ANY_AVAILABLE";

export interface BookingDto {
  id: string;
  tenantId: string;
  locationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerNote: string | null;
  serviceId: string;
  staffId: string;
  serviceAssignments?: Array<{ serviceId: string; staffId: string; startsAt: string; endsAt: string; segmentIndex: number }>;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  pendingExpiresAt: string | null;
  serviceSnapshot: { name: string; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; priceMinor: number; currency: string; services?: Array<{ id: string; name: string; durationMinutes: number; priceMinor: number; staffId?: string | null; startsAt?: string; segmentIndex?: number }> };
  policySnapshot: { confirmationMode: ConfirmationMode; cancellationCutoffMinutes: number; rescheduleCutoffMinutes: number; minLeadMinutes: number; bookingHorizonDays: number; slotIntervalMinutes: number; pendingExpiryMinutes: number; version: number };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookingCountPointDto {
  date: string;
  count: number;
}

export interface ServiceBookingCountDto {
  serviceId: string;
  serviceName: string;
  count: number;
}

export interface BookingRevenuePointDto {
  date: string;
  amountMinor: number;
  bookingCount: number;
}

export interface AvailabilitySlotDto {
  startsAt: string;
  localStart: string;
  timezone: string;
  staffIds: string[];
}

export interface BookingScheduleSegmentDto {
  serviceId: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  segmentIndex: number;
}

export interface BookingScheduleSuggestionDto {
  startsAt: string;
  localStart: string;
  timezone: string;
  segments: BookingScheduleSegmentDto[];
  omittedServiceIds: string[];
}

export interface CreateBookingRequest {
  serviceId: string;
  serviceIds?: string[];
  serviceAssignments?: Array<{ serviceId: string; staffId: string; startsAt: string }>;
  startsAt: string;
  staffSelection: StaffSelection;
  staffId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerNote?: string;
}

export interface RescheduleBookingRequest {
  startsAt: string;
  staffSelection: StaffSelection;
  staffId?: string;
  serviceAssignments?: Array<{ serviceId: string; staffId: string; startsAt: string }>;
}

export interface PublicServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
}

export interface PublicCreateBookingRequest extends Omit<CreateBookingRequest, 'customerPhone'> {
  customerPhone: string;
  customerEmail?: string;
}
export interface PublicStaffDto { id: string; name: string }
export interface GuestAccessRequest { bookingId: string; email: string }
export interface GuestTokenRedemptionRequest { token: string }
export interface GuestSessionResponse { accessToken: string; bookingId: string; expiresAt: string }
export interface GuestRescheduleRequest extends RescheduleBookingRequest {}
export interface PublicBookingSummary {
  id: string;
  serviceId: string;
  customerNote?: string | null;
  staffId: string;
  serviceAssignments?: Array<{ serviceId: string; staffId: string; startsAt: string; endsAt: string; segmentIndex: number }>;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  serviceName: string;
  version: number;
}

export interface MembershipDto {
  id: string;
  tenantId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  user?: AuthUser;
}

export interface CreateMembershipRequest {
  email: string;
  role: MembershipRole;
}

export interface UpdateMembershipRequest {
  role?: MembershipRole;
  status?: MembershipStatus;
}

export interface TenantContextDto {
  tenant: TenantDto;
  location: LocationDto;
  role: MembershipRole;
  status: MembershipStatus;
  themeKey: TenantThemeKey | null;
  themeMode: TenantThemeMode;
}

export interface ApiErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  timestamp: string;
  path?: string;
  requestId?: string;
}

export interface PlatformAdminBootstrapRequest { token: string }
export interface PlatformAdminBootstrapResponse { isPlatformAdmin: true }
export interface PlatformAdminBootstrapStatus {
  available: boolean;
  tokenConfigured: boolean;
  adminInitialized: boolean;
}
export interface UpdatePlatformSettingsRequest {
  currentPassword: string;
  publicAppUrl?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    password?: string;
    fromEmail: string;
    fromName?: string;
  };
  guestTokenKey?: { keyId: string; key: string };
  paymentProviders?: {
    vnpay?: { enabled: boolean; mode: 'sandbox' | 'production'; tmnCode?: string; hashSecret?: string };
    momo?: { enabled: boolean; mode: 'sandbox' | 'production'; partnerCode?: string; accessKey?: string; secretKey?: string };
  };
}
export type PlatformSettingsTestSection = 'publicUrl' | 'smtp' | 'guestToken' | 'vnpay' | 'momo';
export interface TestPlatformSettingsRequest {
  section: PlatformSettingsTestSection;
  currentPassword: string;
  recipient?: string;
}
export interface UnlockPlatformSettingsRequest {
  currentPassword: string;
}
export interface PlatformSettingsTestResult {
  section: PlatformSettingsTestSection;
  status: 'passed' | 'partial' | 'failed';
  checkedAt: string;
  message: string;
}
export interface PlatformSettingsStatus {
  encryptionReady: boolean;
  publicAppUrl?: string;
  checks?: Partial<Record<PlatformSettingsTestSection, PlatformSettingsTestResult>>;
  smtp: {
    configured: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string;
    fromEmail?: string;
    fromName?: string;
    passwordConfigured: boolean;
  };
  guestToken: { configured: boolean; activeKeyId?: string; keyIds: string[] };
  paymentProviders: {
    vnpay: { enabled: boolean; configured: boolean; mode: 'sandbox' | 'production' };
    momo: { enabled: boolean; configured: boolean; mode: 'sandbox' | 'production' };
  };
  paymentCallbackUrls?: { vnpay: string; momo: string };
}

export type BillingProvider = 'vnpay' | 'momo';
export interface PlanDto {
  id: string; code: string; version: number; displayName: string;
  priceVnd: number; currency: 'VND'; activeStaffLimit: number; monthlyBookingLimit: number | null;
  sortOrder: number; features: string[];
}
export interface PlatformPlanDto extends PlanDto { isActive: boolean; subscriptionCount: number; }
export interface UpsertPlanRequest {
  code: string; displayName: string; priceVnd: number; activeStaffLimit: number;
  monthlyBookingLimit: number | null; sortOrder: number; features: string[];
}
export interface AssignTenantPlanRequest { planId: string; note: string; currentPassword: string; }
export interface TenantBillingDto {
  plan: PlanDto; status: 'active' | 'past_due' | 'expired';
  periodStart: string; periodEnd: string;
  usage: { activeStaff: number; bookings: number; bookingLimit: number | null };
  providers: { vnpay: boolean; momo: boolean };
}
export interface BillingCheckoutRequest { planId: string; provider: BillingProvider }
export interface BillingCheckoutResponse { orderId: string; status: 'pending'; checkoutUrl: string }
export interface BillingOrderDto {
  id: string; plan: PlanDto; provider: BillingProvider; amountVnd: number;
  status: 'pending' | 'paid' | 'paid_review' | 'failed' | 'expired' | 'cancelled' | 'refunded';
  expiresAt: string; createdAt: string;
}

export interface PlatformBillingFilters {
  search?: string; status?: string; provider?: BillingProvider; planCode?: string;
  from?: string; to?: string; page?: number; pageSize?: number;
}
export interface PlatformBillingSummaryDto {
  activeSubscriptions: number; pastDueSubscriptions: number; expiredSubscriptions: number;
  pendingOrders: number; stalePendingOrders: number; failedOrders: number; expiredOrders: number;
  paidReviewOrders: number; refundPendingOrders: number; refundedOrders: number; refundedTotalVnd: string;
  paidOrders: number; paidTotalVnd: string; paidOrdersThisMonth: number; paidTotalThisMonthVnd: string;
  revenueFrom: string; revenueTo: string; revenueGranularity: 'day' | 'month' | 'year';
  revenueSeries: Array<{ period: string; orderCount: number; amountVnd: string }>;
  tenantPlanDistribution: Array<{ planCode: string; planName: string; tenantCount: number }>;
}
export interface PlatformBillingSubscriptionDto {
  tenantId: string; tenantName: string; tenantSlug: string; tenantStatus: string;
  ownerName: string | null; ownerEmail: string | null;
  planId: string; planCode: string; planName: string; planVersion: number; priceVnd: number;
  status: 'active' | 'past_due' | 'expired'; periodStart: string; periodEnd: string;
  activeStaff: number; staffLimit: number; bookings: number; bookingLimit: number | null;
}
export interface PlatformBillingSubscriptionPageDto {
  items: PlatformBillingSubscriptionDto[]; total: number; page: number; pageSize: number;
}
export interface PlatformBillingOrderDto {
  id: string; tenantId: string; tenantName: string; tenantSlug: string;
  ownerName: string | null; ownerEmail: string | null;
  planCode: string; planName: string; planVersion: number;
  provider: BillingProvider; amountVnd: number; currency: 'VND';
  status: BillingOrderDto['status']; createdAt: string; expiresAt: string; paidAt: string | null;
  attempt: { status: string; transactionReference: string | null; createdAt: string; completedAt: string | null } | null;
  webhook: { status: string; signatureVerified: boolean; receivedAt: string; processedAt: string | null } | null;
  refund: { id: string; status: 'started' | 'pending' | 'succeeded' | 'failed' | 'unknown'; amountVnd: number; reason: string; providerReference: string | null; message: string | null; requestedAt: string; completedAt: string | null } | null;
}
export interface PlatformBillingOrderPageDto {
  items: PlatformBillingOrderDto[]; total: number; page: number; pageSize: number;
}
export interface PlatformBillingReconciliationDto {
  orderId: string; outcome: 'paid' | 'paid_review' | 'not_paid' | 'error'; message: string;
  responseCode: string | null; transactionStatus: string | null; transactionReference: string | null;
  completedAt: string;
}
export interface RefundPaymentRequest { currentPassword: string; reason: string; }
export interface ReconcileRefundRequest { currentPassword: string; }
export interface PlatformBillingRefundDto {
  orderId: string; refundId: string; status: 'pending' | 'succeeded' | 'failed' | 'unknown';
  amountVnd: number; provider: BillingProvider; message: string; completedAt: string | null;
}
export interface ReconcileRefundDto {
  orderId: string; refundId: string; status: 'pending' | 'succeeded' | 'failed' | 'unknown';
  amountVnd: number; provider: BillingProvider; message: string; completedAt: string | null;
}
export interface ApplyLatePaymentRequest { currentPassword: string; note: string; }

export type SupportTicketStatus = 'waiting_admin' | 'waiting_tenant' | 'resolved' | 'closed';
export type SupportTicketCategory = 'billing' | 'account' | 'booking' | 'technical' | 'other';
export interface CreateSupportTicketRequest { subject: string; category: SupportTicketCategory; message: string; billingOrderId?: string | null; }
export interface CreateSupportMessageRequest { message: string; }
export interface UpdateSupportTicketStatusRequest { status: SupportTicketStatus; }
export interface SupportMessageDto { id: string; senderRole: 'tenant' | 'platform_admin'; senderName: string; message: string; createdAt: string; }
export interface SupportTicketDto {
  id: string; tenantId: string; tenantName?: string; tenantSlug?: string; subject: string;
  category: SupportTicketCategory; status: SupportTicketStatus; billingOrderId: string | null;
  createdAt: string; updatedAt: string; messages?: SupportMessageDto[];
}
