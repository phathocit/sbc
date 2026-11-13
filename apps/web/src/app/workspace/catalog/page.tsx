'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import type { CreateScheduleExceptionRequest, CreateServiceRequest, CreateStaffRequest, CreateStaffShiftTemplateRequest, ScheduleExceptionDto, ServiceDto, StaffDto, StaffShiftTemplateDto, TenantContextDto, TenantPolicyDto, UpdateServiceRequest, WeeklyWorkingHoursRequest, WorkingHourDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';

const weekdays = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
type TimeInterval = { localStart: string; localEnd: string };
type CatalogSection = 'services' | 'staff' | 'hours' | 'policies-exceptions';
const fieldStyle: React.CSSProperties = { width: '100%', padding: '0.65rem 0.75rem', border: '1px solid var(--line)', borderRadius: '0.55rem', background: '#fff', color: 'var(--ink)', font: 'inherit' };
const buttonStyle: React.CSSProperties = { padding: '0.65rem 0.9rem', border: 0, borderRadius: '0.55rem', color: '#fff', background: 'var(--accent)', fontWeight: 700, cursor: 'pointer' };
const cardStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '1rem', padding: '1.25rem' };

function intervalsFromRows(rows: WorkingHourDto[], weekday: number): TimeInterval[] {
  return rows.filter((row) => row.weekday === weekday).map((row) => ({ localStart: row.localStart.slice(0, 5), localEnd: row.localEnd.slice(0, 5) }));
}

function intervalPayload(rows: TimeInterval[]) {
  for (const row of rows) {
    if (!row.localStart || !row.localEnd) throw new Error('Hãy chọn giờ bắt đầu và giờ kết thúc cho từng khoảng.');
    if (row.localEnd <= row.localStart) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
  }
  return rows.map(({ localStart, localEnd }) => ({ localStart, localEnd }));
}
function weeklyHours(rows: WorkingHourDto[]) { return rows.reduce((total, row) => { const [sh, sm] = row.localStart.split(':').map(Number); const [eh, em] = row.localEnd.split(':').map(Number); return total + (eh * 60 + em - sh * 60 - sm) / 60; }, 0); }
function localDateValue(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function shiftDateValue(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function mondayOf(value: string) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10); }
function weekdayOf(value: string) { return new Date(`${value}T12:00:00Z`).getUTCDay(); }
function shortDate(value: string) { return formatWorkspaceDate(value, { year: false }); }
function dayMonthSlash(value: string) { return formatWorkspaceDate(value, { year: false }); }
function catalogSectionFromUrl(value: string | null, schedule: string | null): CatalogSection {
  if (value === 'staff-hours') return schedule === 'week' || schedule === 'month' ? 'hours' : 'staff';
  if (value === 'staff') return 'staff';
  if (value === 'hours') return 'hours';
  if (value === 'policies' || value === 'exceptions' || value === 'policies-exceptions') return 'policies-exceptions';
  return 'services';
}

export default function CatalogWorkspacePage() {
  const router = useRouter();
  const query = useSearchParams();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [staff, setStaff] = useState<StaffDto[]>([]);
  const [staffShiftTemplates, setStaffShiftTemplates] = useState<StaffShiftTemplateDto[]>([]);
  const [businessHours, setBusinessHours] = useState<WorkingHourDto[]>([]);
  const [staffHoursById, setStaffHoursById] = useState<Record<string, WorkingHourDto[]>>({});
  const [staffScheduleMode, setStaffScheduleMode] = useState<'week' | 'month'>(query.get('schedule') === 'month' ? 'month' : 'week');
  const [staffScheduleMonth, setStaffScheduleMonth] = useState(/^\d{4}-\d{2}$/.test(query.get('month') ?? '') ? query.get('month')! : new Date().toISOString().slice(0, 7));
  const [staffScheduleWeekDate, setStaffScheduleWeekDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(query.get('week') ?? '') ? query.get('week')! : localDateValue());
  const [staffScheduleSearch, setStaffScheduleSearch] = useState('');
  const [scheduleCellOpen, setScheduleCellOpen] = useState(false);
  const [scheduleAnchor, setScheduleAnchor] = useState<HTMLButtonElement | null>(null);
  const [schedulePopoverPosition, setSchedulePopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [scheduleDraftDirty, setScheduleDraftDirty] = useState(false);
  const [scheduleConfirmationOpen, setScheduleConfirmationOpen] = useState(false);
  const schedulePopoverRef = useRef<HTMLFormElement | null>(null);
  const [shiftTemplateEditorOpen, setShiftTemplateEditorOpen] = useState(false);
  const [shiftTemplateDraftDirty, setShiftTemplateDraftDirty] = useState(false);
  const shiftTemplateModalRef = useRef<HTMLFormElement | null>(null);
  const [shiftTemplateDraft, setShiftTemplateDraft] = useState<{ name: string; intervals: TimeInterval[] }>({ name: '', intervals: [{ localStart: '09:00', localEnd: '17:00' }] });
  const [editingShiftTemplateId, setEditingShiftTemplateId] = useState<string | null>(null);
  const [selectedShiftTemplateId, setSelectedShiftTemplateId] = useState('');
  const [manualStaffHours, setManualStaffHours] = useState(false);
  const [exceptions, setExceptions] = useState<ScheduleExceptionDto[]>([]);
  const [policies, setPolicies] = useState<TenantPolicyDto | null>(null);
  const [savedPolicies, setSavedPolicies] = useState<TenantPolicyDto | null>(null);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderMinutes, setReminderMinutes] = useState('30');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<CatalogSection>(() => catalogSectionFromUrl(query.get('section'), query.get('schedule')));
  const [businessIntervalsByDay, setBusinessIntervalsByDay] = useState<Record<number, TimeInterval[]>>({});
  const [staffIdForHours, setStaffIdForHours] = useState('');
  const [staffDay, setStaffDay] = useState(1);
  const [staffIntervals, setStaffIntervals] = useState<TimeInterval[]>([]);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [selectedStaffServiceIds, setSelectedStaffServiceIds] = useState<string[]>([]);
  const [editingStaffName, setEditingStaffName] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [serviceEditDraft, setServiceEditDraft] = useState<{ name: string; description: string; duration: string; price: string; before: string; after: string; published: boolean } | null>(null);
  const serviceFormAccordionRef = useRef<HTMLDetailsElement>(null);
  const [showArchivedStaff, setShowArchivedStaff] = useState(query.get('staff') === 'archived');
  const serviceFilterFromUrl = query.get('service');
  const [serviceFilter, setServiceFilter] = useState<'active' | 'hidden' | 'archived'>(() => serviceFilterFromUrl === 'hidden' || serviceFilterFromUrl === 'archived' ? serviceFilterFromUrl : 'active');
  const businessIntervalsInitialized = useRef(false);
  const [exceptionScope, setExceptionScope] = useState<'location' | 'staff'>('location');
  const [exceptionStaffId, setExceptionStaffId] = useState('');
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionStart, setExceptionStart] = useState('09:00');
  const [exceptionEnd, setExceptionEnd] = useState('17:00');
  const [exceptionKind, setExceptionKind] = useState<'unavailable' | 'available'>('unavailable');
  const [exceptionReason, setExceptionReason] = useState('');

  function closeScheduleEditor() {
    if (scheduleDraftDirty && !window.confirm('Đóng phần xếp ca? Các thay đổi chưa lưu sẽ bị bỏ.')) return;
    scheduleAnchor?.focus();
    setScheduleCellOpen(false);
    setScheduleAnchor(null);
    setSchedulePopoverPosition(null);
    setScheduleDraftDirty(false);
    setScheduleConfirmationOpen(false);
    setSelectedShiftTemplateId('');
    setManualStaffHours(false);
  }

  useEffect(() => {
    if (!scheduleCellOpen || !scheduleAnchor) return;
    const updatePosition = () => {
      const popover = schedulePopoverRef.current;
      if (!popover || !scheduleAnchor.isConnected) return;
      const anchor = scheduleAnchor.getBoundingClientRect();
      const panel = popover.getBoundingClientRect();
      const gap = 10;
      const margin = 8;
      const right = anchor.right + gap;
      const left = right + panel.width <= window.innerWidth - margin
        ? right
        : Math.max(margin, anchor.left - panel.width - gap);
      const top = Math.max(margin, Math.min(anchor.top, window.innerHeight - panel.height - margin));
      setSchedulePopoverPosition((current) => current && current.left === left && current.top === top ? current : { left, top });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (schedulePopoverRef.current) observer.observe(schedulePopoverRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [scheduleCellOpen, scheduleAnchor]);

  useEffect(() => {
    if (!scheduleCellOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || schedulePopoverRef.current?.contains(target) || scheduleAnchor?.contains(target)) return;
      if (scheduleDraftDirty && !window.confirm('Đóng phần xếp ca? Các thay đổi chưa lưu sẽ bị bỏ.')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      setScheduleCellOpen(false);
      setScheduleAnchor(null);
      setSchedulePopoverPosition(null);
      setScheduleDraftDirty(false);
      setScheduleConfirmationOpen(false);
      setSelectedShiftTemplateId('');
      setManualStaffHours(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeScheduleEditor();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [scheduleCellOpen, scheduleAnchor, scheduleDraftDirty]);

  useEffect(() => {
    if (!shiftTemplateEditorOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeShiftTemplateEditor();
      } else if (event.key === 'Tab' && shiftTemplateModalRef.current) {
        const controls = [...shiftTemplateModalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKeyDown, true); };
  }, [shiftTemplateEditorOpen, shiftTemplateDraftDirty]);

  const load = useCallback(async (activeTenantId: string) => {
    setLoading(true);
    setError('');
    try {
      const [current, serviceRows, staffRows, hours, exceptionRows, policyRows, shiftTemplates] = await Promise.all([
        api.getCurrentTenant(activeTenantId), api.listServices(activeTenantId),
        api.listStaff(activeTenantId), api.listBusinessHours(activeTenantId),
        api.listScheduleExceptions(activeTenantId), api.getPolicies(activeTenantId), api.listStaffShiftTemplates(activeTenantId),
      ]);
      const staffSchedules = await Promise.all(staffRows.map(async (person) => [person.id, await api.listStaffHours(activeTenantId, person.id)] as const));
      setContext(current); setServices(serviceRows); setStaff(staffRows); setStaffShiftTemplates(shiftTemplates); setBusinessHours(hours); setExceptions(exceptionRows); setPolicies(policyRows); setSavedPolicies(policyRows);
      setReminderEnabled(policyRows.appointmentReminderMinutes !== null); setReminderMinutes(String(policyRows.appointmentReminderMinutes ?? 30));
      setStaffHoursById(Object.fromEntries(staffSchedules));
      if (!businessIntervalsInitialized.current) {
        setBusinessIntervalsByDay(Object.fromEntries(Array.from({ length: 7 }, (_, weekday) => [weekday, intervalsFromRows(hours, weekday)])));
        businessIntervalsInitialized.current = true;
      }
      setStaffIdForHours((previous) => previous || staffRows[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu cấu hình.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const savedTenantId = localStorage.getItem('sbc_tenant_id');
    if (!savedTenantId) { router.replace('/login'); return; }
    setTenantId(savedTenantId); void load(savedTenantId);
  }, [load, router]);

  const canEdit = context?.role === 'owner' || context?.role === 'admin' || context?.role === 'receptionist';
  const canEditReminder = context?.role === 'owner';
  const activeStaff = useMemo(() => staff.filter((person) => person.active), [staff]);
  const activeServices = useMemo(() => services.filter((service) => service.active && service.published), [services]);
  const hiddenServices = useMemo(() => services.filter((service) => service.active && !service.published), [services]);
  const archivedServices = useMemo(() => services.filter((service) => !service.active), [services]);
  const visibleServices = serviceFilter === 'archived' ? archivedServices : serviceFilter === 'hidden' ? hiddenServices : activeServices;

  useEffect(() => {
    const section = catalogSectionFromUrl(query.get('section'), query.get('schedule'));
    setActiveSection(section);
    if (query.get('section') && query.get('section') !== section) updateCatalogUrl({ section });
    setShowArchivedStaff(query.get('staff') === 'archived');
    const requestedServiceFilter = query.get('service');
    setServiceFilter(requestedServiceFilter === 'hidden' || requestedServiceFilter === 'archived' ? requestedServiceFilter : 'active');
    setStaffScheduleMode(query.get('schedule') === 'month' ? 'month' : 'week');
    const month = query.get('month');
    setStaffScheduleMonth(month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7));
    const week = query.get('week');
    setStaffScheduleWeekDate(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : localDateValue());
  }, [query]);

  function updateCatalogUrl(changes: Record<string, string | null>) {
    const params = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key); else params.set(key, value);
    }
    const search = params.toString();
    router.replace(`/workspace/catalog${search ? `?${search}` : ''}`, { scroll: false });
  }

  async function action(work: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(success); if (tenantId) await load(tenantId); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu thay đổi.'); return false; }
    finally { setBusy(false); }
  }

  async function saveStaffDetails(person: StaffDto) {
    const name = editingStaffName.trim();
    if (!name) { setError('Nhập tên nhân viên trước khi lưu.'); return; }
    const saved = await action(() => api.updateStaff(tenantId!, person.id, { name, serviceIds: selectedStaffServiceIds }), 'Đã cập nhật hồ sơ nhân viên.');
    if (saved) setEditingStaffId(null);
  }

  function beginServiceEdit(service: ServiceDto) {
    const filter = !service.active ? 'archived' : service.published ? 'active' : 'hidden';
    setServiceFilter(filter);
    setActiveSection('services');
    updateCatalogUrl({ section: 'services', service: filter });
    setEditingServiceId(service.id);
    setServiceEditDraft({ name: service.name, description: service.description ?? '', duration: String(service.durationMinutes), price: new Intl.NumberFormat('vi-VN').format(service.priceMinor), before: String(service.bufferBeforeMinutes), after: String(service.bufferAfterMinutes), published: service.published });
    serviceFormAccordionRef.current?.setAttribute('open', '');
    requestAnimationFrame(() => serviceFormAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  async function saveServiceEdit(event: FormEvent, service: ServiceDto) {
    event.preventDefault();
    if (!tenantId || !serviceEditDraft) return;
    const priceMinor = Number(serviceEditDraft.price.replace(/\D/g, ''));
    const durationMinutes = Number(serviceEditDraft.duration);
    const bufferBeforeMinutes = Number(serviceEditDraft.before);
    const bufferAfterMinutes = Number(serviceEditDraft.after);
    if (!serviceEditDraft.name.trim() || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 || !Number.isInteger(priceMinor) || priceMinor < 0 || !Number.isInteger(bufferBeforeMinutes) || bufferBeforeMinutes < 0 || bufferBeforeMinutes > 1440 || !Number.isInteger(bufferAfterMinutes) || bufferAfterMinutes < 0 || bufferAfterMinutes > 1440) {
      setError('Kiểm tra tên, thời lượng, giá và các khoảng đệm của dịch vụ.'); return;
    }
    const dto: UpdateServiceRequest = { name: serviceEditDraft.name.trim(), description: serviceEditDraft.description.trim(), durationMinutes, priceMinor, bufferBeforeMinutes, bufferAfterMinutes, published: serviceEditDraft.published };
    if (!window.confirm(`Lưu thay đổi dịch vụ “${service.name}”? Thay đổi chỉ áp dụng cho lịch mới; lịch đã tạo vẫn giữ thông tin lúc khách đặt.`)) return;
    if (await action(() => api.updateService(tenantId, service.id, dto), 'Đã cập nhật dịch vụ.')) { setEditingServiceId(null); setServiceEditDraft(null); serviceFormAccordionRef.current?.removeAttribute('open'); }
  }

  async function savePolicies(event: FormEvent) {
    event.preventDefault();
    if (!policies || !tenantId) return;
    const reminderMinutesValue = Number(reminderMinutes);
    if (canEditReminder && reminderEnabled && (!Number.isInteger(reminderMinutesValue) || reminderMinutesValue < 1 || reminderMinutesValue > 1440)) {
      setError('Thời gian nhắc phải từ 1 đến 1440 phút.');
      return;
    }
    const confirmMessage = canEditReminder
      ? 'Lưu chính sách đặt lịch và nhắc lịch? Chính sách đặt lịch áp dụng cho lượt mới; thời gian nhắc áp dụng cho các lịch đã xác nhận trong tương lai.'
      : 'Lưu các chính sách đặt lịch mới? Thay đổi sẽ áp dụng cho những lượt đặt mới.';
    if (!window.confirm(confirmMessage)) return;
    await action(() => api.updatePolicies(tenantId, {
      confirmationMode: policies.confirmationMode, pendingExpiryMinutes: policies.pendingExpiryMinutes,
      cancellationCutoffMinutes: policies.cancellationCutoffMinutes, rescheduleCutoffMinutes: policies.rescheduleCutoffMinutes,
      minLeadMinutes: policies.minLeadMinutes, bookingHorizonDays: policies.bookingHorizonDays, slotIntervalMinutes: policies.slotIntervalMinutes,
      ...(canEditReminder ? { appointmentReminderMinutes: reminderEnabled ? reminderMinutesValue : null } : {}),
    }), 'Đã lưu chính sách đặt lịch và nhắc lịch.');
  }

  async function saveBusinessWeek(event: FormEvent) {
    event.preventDefault();
    try {
      const dto: WeeklyWorkingHoursRequest = { days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: intervalPayload(businessIntervalsByDay[weekday] ?? []) })) };
      if (!window.confirm('Lưu giờ mở cửa cho cả 7 ngày? Các giờ đang lưu sẽ được thay bằng lịch tuần mới.')) return;
      await action(() => api.setBusinessHoursWeek(tenantId!, dto), 'Đã lưu giờ mở cửa cả tuần.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kiểm tra lại giờ mở cửa từng ngày.'); }
  }

  async function saveStaffDay(event: FormEvent) {
    event.preventDefault();
    if (!staffIdForHours) return;
    if (!manualStaffHours && !selectedShiftTemplateId) { setError('Chọn một ca cố định hoặc chuyển sang nhập thủ công.'); return; }
    try {
      intervalPayload(staffIntervals);
      setError(''); setMessage(''); setScheduleConfirmationOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kiểm tra lại khoảng giờ của ca.'); }
  }

  async function confirmSaveStaffDay() {
    if (!staffIdForHours || !tenantId || !canEdit) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const intervals = intervalPayload(staffIntervals);
      const saved = await api.setStaffHours(tenantId, staffIdForHours, staffDay, { intervals });
      setStaffHoursById((current) => ({ ...current, [staffIdForHours]: [...(current[staffIdForHours] ?? []).filter((row) => row.weekday !== staffDay), ...saved] }));
      setMessage('Đã lưu ca làm.'); setError(''); setScheduleCellOpen(false); setScheduleAnchor(null); setSchedulePopoverPosition(null); setScheduleDraftDirty(false); setScheduleConfirmationOpen(false); setSelectedShiftTemplateId(''); setManualStaffHours(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không lưu được ca làm.'); }
    finally { setBusy(false); }
  }

  function beginShiftTemplateEdit(template?: StaffShiftTemplateDto) {
    setShiftTemplateEditorOpen(true);
    setShiftTemplateDraftDirty(false);
    setError('');
    setEditingShiftTemplateId(template?.id ?? null);
    setShiftTemplateDraft(template
      ? { name: template.name, intervals: template.intervals.map(({ localStart, localEnd }) => ({ localStart: localStart.slice(0, 5), localEnd: localEnd.slice(0, 5) })) }
      : { name: '', intervals: [{ localStart: '09:00', localEnd: '17:00' }] });
  }

  function closeShiftTemplateEditor() {
    if (shiftTemplateDraftDirty && !window.confirm('Đóng biểu mẫu? Các thay đổi chưa lưu sẽ bị bỏ.')) return;
    setShiftTemplateEditorOpen(false);
    setShiftTemplateDraftDirty(false);
    setEditingShiftTemplateId(null);
    setShiftTemplateDraft({ name: '', intervals: [{ localStart: '09:00', localEnd: '17:00' }] });
  }

  async function saveShiftTemplate(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    try {
      const dto: CreateStaffShiftTemplateRequest = { name: shiftTemplateDraft.name.trim(), intervals: intervalPayload(shiftTemplateDraft.intervals) };
      if (!dto.name || dto.name.length > 80 || !dto.intervals.length) throw new Error('Nhập tên ca và ít nhất một khoảng giờ hợp lệ.');
      if (!canEdit) return;
      setBusy(true); setError(''); setMessage('');
      const saved = editingShiftTemplateId
        ? await api.updateStaffShiftTemplate(tenantId, editingShiftTemplateId, dto)
        : await api.createStaffShiftTemplate(tenantId, dto);
      setStaffShiftTemplates((templates) => [...templates.filter((template) => template.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
      setMessage(editingShiftTemplateId ? 'Đã cập nhật ca cố định. Lịch nhân viên đã xếp trước đó không thay đổi.' : 'Đã tạo ca cố định.');
      setShiftTemplateEditorOpen(false); setShiftTemplateDraftDirty(false); setEditingShiftTemplateId(null);
      setShiftTemplateDraft({ name: '', intervals: [{ localStart: '09:00', localEnd: '17:00' }] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kiểm tra tên ca và các khoảng giờ.'); }
    finally { setBusy(false); }
  }

  function resetExceptionForm() {
    setExceptionScope('location'); setExceptionStaffId(''); setExceptionDate('');
    setExceptionStart('09:00'); setExceptionEnd('17:00'); setExceptionKind('unavailable'); setExceptionReason('');
  }

  async function submitException(event: FormEvent) {
    event.preventDefault();
    try { intervalPayload([{ localStart: exceptionStart, localEnd: exceptionEnd }]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Kiểm tra lại khoảng giờ ngoại lệ.'); return; }
    if (!tenantId || !window.confirm('Thêm ngoại lệ lịch này? Ngoại lệ sẽ ảnh hưởng đến khả năng nhận lịch trong khoảng thời gian đã chọn.')) return;
    const dto: CreateScheduleExceptionRequest = { scope: exceptionScope, staffId: exceptionScope === 'staff' ? exceptionStaffId : undefined, onDate: exceptionDate, localStart: exceptionStart, localEnd: exceptionEnd, kind: exceptionKind, reason: exceptionReason };
    if (await action(() => api.createScheduleException(tenantId, dto), 'Đã thêm ngoại lệ lịch.')) resetExceptionForm();
  }

  const scheduleWeekStart = mondayOf(staffScheduleWeekDate);
  const scheduleWeekDates = Array.from({ length: 7 }, (_, index) => shiftDateValue(scheduleWeekStart, index));
  const [scheduleYear, scheduleMonthNumber] = staffScheduleMonth.split('-').map(Number);
  const scheduleMonthDates = Array.from({ length: new Date(Date.UTC(scheduleYear, scheduleMonthNumber, 0)).getUTCDate() }, (_, index) => `${staffScheduleMonth}-${String(index + 1).padStart(2, '0')}`);
  const scheduleColumns = staffScheduleMode === 'week'
    ? scheduleWeekDates.map((date) => ({ date, day: weekdayOf(date), label: `${weekdays[weekdayOf(date)]} (${dayMonthSlash(date)})` }))
    : scheduleMonthDates.map((date) => ({ date, day: weekdayOf(date), label: `${weekdays[weekdayOf(date)]} (${dayMonthSlash(date)})` }));
  function totalScheduleHours(rows: WorkingHourDto[]) {
    return staffScheduleMode === 'week'
      ? weeklyHours(rows)
      : scheduleMonthDates.reduce((total, date) => total + weeklyHours(rows.filter((row) => row.weekday === weekdayOf(date))), 0);
  }
  const businessOpenDays = Object.values(businessIntervalsByDay).filter((intervals) => intervals.length > 0).length;
  const businessIntervalCount = Object.values(businessIntervalsByDay).reduce((total, intervals) => total + intervals.length, 0);
  const editingService = services.find((service) => service.id === editingServiceId) ?? null;

  if (loading) return <main className="page-shell"><p>Đang tải cấu hình...</p></main>;
  if (!tenantId || !context) return <main className="page-shell"><section className="welcome-card"><h2>Không mở được cấu hình</h2><p>{error}</p><button style={buttonStyle} onClick={() => router.push('/workspace')}>Quay lại workspace</button></section></main>;

  return <main className="owner-page owner-catalog">
    <div className="app-container stack-md">
      <header className="owner-page-heading"><h1>{activeSection === 'services' ? 'Dịch vụ' : activeSection === 'staff' ? 'Nhân viên' : activeSection === 'hours' ? 'Giờ làm' : 'Chính sách & ngoại lệ'}</h1></header>

      {(error || message) && <div role={error ? 'alert' : 'status'} aria-live="polite" className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || message}</div>}

      <section className="surface-card" id="owner-policies" role="region" aria-label="Chính sách đặt lịch" hidden={activeSection !== 'policies-exceptions'}>
        <h2 style={{ marginTop: 0 }}>Chính sách đặt lịch</h2>
        <p className="owner-form-intro">Chính sách đặt lịch áp dụng cho lượt mới; thời gian nhắc áp dụng cho lịch đã xác nhận trong tương lai. Lịch đã tạo giữ nguyên trạng thái và thông tin tại thời điểm khách đặt.</p>
        {policies && <form className="owner-policy-list" onSubmit={(event) => void savePolicies(event)}>
          <label className="owner-policy-row"><span><strong>Chế độ xác nhận</strong><small>Tự động xác nhận lịch ngay sau khi khách gửi, hoặc giữ lịch ở trạng thái chờ để tiệm duyệt.</small></span><select disabled={!canEdit} style={fieldStyle} value={policies.confirmationMode} onChange={(e) => setPolicies({ ...policies, confirmationMode: e.target.value as TenantPolicyDto['confirmationMode'] })}><option value="AUTO">Tự động</option><option value="MANUAL">Tiệm duyệt thủ công</option></select></label>
          <label className="owner-policy-row"><span><strong>Thời gian giữ lịch chờ</strong><small>Sau khoảng thời gian này, yêu cầu chưa được duyệt sẽ hết hạn để khung giờ không bị giữ lâu.</small></span><span className="owner-policy-input"><input disabled={!canEdit} style={fieldStyle} type="number" min="15" max="1440" value={policies.pendingExpiryMinutes} onChange={(e) => setPolicies({ ...policies, pendingExpiryMinutes: Number(e.target.value) })}/><small>phút</small></span></label>
          <label className="owner-policy-row"><span><strong>Hạn khách được hủy</strong><small>Khách chỉ có thể hủy trước giờ hẹn tối thiểu theo thời hạn này.</small></span><span className="owner-policy-input"><input disabled={!canEdit} style={fieldStyle} type="number" min="0" max="4320" value={policies.cancellationCutoffMinutes} onChange={(e) => setPolicies({ ...policies, cancellationCutoffMinutes: Number(e.target.value) })}/><small>phút trước giờ hẹn</small></span></label>
          <label className="owner-policy-row"><span><strong>Hạn khách được đổi lịch</strong><small>Giới hạn thời điểm muộn nhất khách có thể tự chọn giờ hẹn khác.</small></span><span className="owner-policy-input"><input disabled={!canEdit} style={fieldStyle} type="number" min="0" max="4320" value={policies.rescheduleCutoffMinutes} onChange={(e) => setPolicies({ ...policies, rescheduleCutoffMinutes: Number(e.target.value) })}/><small>phút trước giờ hẹn</small></span></label>
          <label className="owner-policy-row"><span><strong>Thời gian báo trước tối thiểu</strong><small>Ngăn khách đặt lịch quá sát giờ hiện tại để tiệm có thời gian chuẩn bị.</small></span><span className="owner-policy-input"><input disabled={!canEdit} style={fieldStyle} type="number" min="0" max="4320" value={policies.minLeadMinutes} onChange={(e) => setPolicies({ ...policies, minLeadMinutes: Number(e.target.value) })}/><small>phút</small></span></label>
          <label className="owner-policy-row"><span><strong>Khoảng thời gian đặt trước</strong><small>Xa nhất khách có thể xem và chọn ngày trên trang đặt lịch.</small></span><span className="owner-policy-input"><input disabled={!canEdit} style={fieldStyle} type="number" min="1" max="90" value={policies.bookingHorizonDays} onChange={(e) => setPolicies({ ...policies, bookingHorizonDays: Number(e.target.value) })}/><small>ngày</small></span></label>
          <label className="owner-policy-row"><span><strong>Bước chia khung giờ</strong><small>Khoảng cách giữa các giờ bắt đầu mà khách có thể chọn.</small></span><select disabled={!canEdit} style={fieldStyle} value={policies.slotIntervalMinutes} onChange={(e) => setPolicies({ ...policies, slotIntervalMinutes: Number(e.target.value) })}>{[5, 10, 15, 30, 60].map((value) => <option key={value} value={value}>{value} phút</option>)}</select></label>
          <div className="owner-policy-row owner-reminder-policy-row"><span><strong>Nhắc lịch hẹn</strong><small>Nhắc chủ tiệm liên hệ khách trước giờ bắt đầu lịch đã xác nhận. Lịch chờ xác nhận vẫn có các mốc riêng ở 20, 10 và 5 phút; hủy, xác nhận hoặc hết hạn sẽ dừng các mốc chờ còn lại. Đổi giờ sẽ tính lại theo lịch mới.</small></span><span className="owner-reminder-policy-controls"><label className="owner-reminder-toggle"><input type="checkbox" checked={reminderEnabled} disabled={!canEditReminder || busy} onChange={(event) => setReminderEnabled(event.target.checked)} /><span><strong>Bật nhắc</strong></span></label><span className="owner-policy-input"><input type="number" inputMode="numeric" min={1} max={1440} step={1} value={reminderMinutes} disabled={!canEditReminder || !reminderEnabled || busy} onChange={(event) => setReminderMinutes(event.target.value)} aria-label="Số phút nhắc trước lịch đã xác nhận"/><small>phút</small></span></span></div>
          {canEdit && <div className="owner-policy-action-bar"><div><strong>Áp dụng thay đổi</strong><small>{canEditReminder ? 'Lưu toàn bộ chính sách đặt lịch và thời gian nhắc.' : 'Lưu các chính sách đặt lịch; cấu hình nhắc lịch chỉ chủ tiệm được thay đổi.'}</small></div><div className="owner-policy-action-buttons"><button type="button" className="button button-secondary" disabled={busy || !savedPolicies} onClick={() => { if (!savedPolicies || !window.confirm('Đặt lại các thay đổi chưa lưu theo chính sách hiện tại?')) return; setPolicies(savedPolicies); setReminderEnabled(savedPolicies.appointmentReminderMinutes !== null); setReminderMinutes(String(savedPolicies.appointmentReminderMinutes ?? 30)); }}>Đặt lại</button><button className="button button-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu chính sách'}</button></div></div>}
        </form>}
        {!canEditReminder && <p className="owner-reminder-policy-readonly">Cấu hình nhắc lịch chỉ chủ tiệm được chỉnh sửa.</p>}
        {!canEdit && <p style={{ color: 'var(--muted)' }}>Bạn có quyền xem. Owner, admin hoặc receptionist có thể chỉnh sửa.</p>}
      </section>

      <section className="surface-card owner-service-management" id="owner-services" role="region" aria-label="Quản lý dịch vụ" hidden={activeSection !== 'services'}>
        <div className="owner-service-list-section"><div className="owner-service-list-heading"><h2>Danh mục dịch vụ <small>{services.length}</small></h2><p className="owner-form-intro"><span>- Ẩn khỏi khách: dịch vụ vẫn được giữ và có thể hiện lại bất cứ lúc nào.</span><span>- Lưu trữ: ngừng dùng cho lịch mới nhưng vẫn giữ hồ sơ và lịch sử đặt cũ; có thể khôi phục.</span></p></div>
          <details ref={serviceFormAccordionRef} className="owner-service-form-accordion">
          <summary className="owner-service-form-trigger" aria-label={editingServiceId ? `Chỉnh sửa dịch vụ ${serviceEditDraft?.name ?? ''}; bấm để thu gọn biểu mẫu` : 'Thêm dịch vụ'}>{editingServiceId ? 'Chỉnh sửa dịch vụ' : <><span aria-hidden="true">+</span> Thêm dịch vụ</>}</summary>
          {editingServiceId && serviceEditDraft && editingService ? <form className="owner-service-editor owner-service-edit-form" onSubmit={(event) => void saveServiceEdit(event, editingService)}>
            <div className="owner-service-edit-grid"><label>Tên dịch vụ<input required maxLength={160} style={fieldStyle} value={serviceEditDraft.name} onChange={(event) => setServiceEditDraft({ ...serviceEditDraft, name: event.target.value })}/></label><label>Mô tả<textarea maxLength={2000} style={{ ...fieldStyle, minHeight: '4rem' }} value={serviceEditDraft.description} onChange={(event) => setServiceEditDraft({ ...serviceEditDraft, description: event.target.value })}/></label>
              <label>Thời lượng ước tính (phút)<input type="number" min="1" max="1440" required style={fieldStyle} value={serviceEditDraft.duration} onChange={(event) => setServiceEditDraft({ ...serviceEditDraft, duration: event.target.value })}/></label><label>Giá dịch vụ (₫)<input type="text" inputMode="numeric" required style={fieldStyle} value={serviceEditDraft.price} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ''); setServiceEditDraft({ ...serviceEditDraft, price: digits ? new Intl.NumberFormat('vi-VN').format(Number(digits)) : '' }); }}/></label>
              <label>Thời gian chuẩn bị trước (phút)<input type="number" min="0" max="1440" required style={fieldStyle} value={serviceEditDraft.before} onChange={(event) => setServiceEditDraft({ ...serviceEditDraft, before: event.target.value })}/></label><label>Thời gian nghỉ sau dịch vụ (phút)<input type="number" min="0" max="1440" required style={fieldStyle} value={serviceEditDraft.after} onChange={(event) => setServiceEditDraft({ ...serviceEditDraft, after: event.target.value })}/></label>
              <label className="owner-service-publish-toggle"><input type="checkbox" checked={serviceEditDraft.published} onChange={(event) => setServiceEditDraft({ ...serviceEditDraft, published: event.target.checked })}/> Hiện dịch vụ trên trang đặt lịch</label>
            </div><div className="owner-service-edit-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => { setEditingServiceId(null); setServiceEditDraft(null); serviceFormAccordionRef.current?.removeAttribute('open'); }}>Hủy</button><button className="button button-primary" disabled={!canEdit || busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div>
          </form> : editingServiceId ? <p className="owner-service-form-note">Không tìm thấy dịch vụ cần chỉnh sửa. Hãy chọn lại dịch vụ trong danh sách.</p> : <form className="owner-service-create-form" onSubmit={(event) => {
            event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
            const priceMinor = Number(priceInput.replace(/\D/g, ''));
            const dto: CreateServiceRequest = { name: String(data.get('name')).trim(), description: String(data.get('description') || '').trim(), durationMinutes: Number(data.get('duration')), bufferBeforeMinutes: Number(data.get('before')), bufferAfterMinutes: Number(data.get('after')), priceMinor, currency: 'VND', published: data.get('published') === 'on' };
            if (!dto.name || !Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 1 || !Number.isInteger(priceMinor) || priceMinor < 0) { setError('Nhập tên dịch vụ, thời lượng hợp lệ và giá bằng hoặc lớn hơn 0.'); return; }
            if (!window.confirm(`Tạo dịch vụ "${dto.name}" với giá ${new Intl.NumberFormat('vi-VN').format(priceMinor)} ₫?`)) return;
            void action(() => api.createService(tenantId, dto), 'Đã thêm dịch vụ.').then((saved) => { if (saved) { form.reset(); setPriceInput(''); serviceFormAccordionRef.current?.removeAttribute('open'); } });
          }}>
            <label className="field-group">Tên dịch vụ<input name="name" required maxLength={160} style={fieldStyle}/></label><label className="field-group">Mô tả (không bắt buộc)<textarea name="description" maxLength={2000} style={{ ...fieldStyle, minHeight: '5rem' }}/></label>
            <div className="owner-service-form-pair"><label>Thời lượng ước tính (phút)<input name="duration" type="number" min="1" max="1440" required style={fieldStyle}/></label><label>Giá dịch vụ (₫)<input name="price" type="text" inputMode="numeric" required value={priceInput} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ''); setPriceInput(digits ? new Intl.NumberFormat('vi-VN').format(Number(digits)) : ''); }} placeholder="Ví dụ: 150.000" style={fieldStyle}/></label></div>
            <div className="owner-service-form-pair"><label>Thời gian chuẩn bị trước (phút)<input name="before" type="number" min="0" max="1440" defaultValue="0" style={fieldStyle}/></label><label>Thời gian nghỉ sau dịch vụ (phút)<input name="after" type="number" min="0" max="1440" defaultValue="0" style={fieldStyle}/></label></div>
            <label className="owner-service-create-publish"><input name="published" type="checkbox"/> Công khai dịch vụ</label><button type="submit" disabled={!canEdit || busy} style={buttonStyle}>{busy ? 'Đang lưu…' : 'Tạo dịch vụ'}</button>
          </form>}
        </details>
        <div className="owner-staff-list-heading"><strong>{serviceFilter === 'active' ? 'Dịch vụ đang hoạt động' : serviceFilter === 'hidden' ? 'Dịch vụ ẩn khỏi khách' : 'Dịch vụ đã lưu trữ'}</strong><div className="owner-staff-list-tabs" role="group" aria-label="Lọc danh mục dịch vụ"><button type="button" className="button button-secondary" aria-pressed={serviceFilter === 'active'} onClick={() => { setServiceFilter('active'); setActiveSection('services'); updateCatalogUrl({ section: 'services', service: 'active' }); }}>Đang hoạt động ({activeServices.length})</button><button type="button" className="button button-secondary" aria-pressed={serviceFilter === 'hidden'} onClick={() => { setServiceFilter('hidden'); setActiveSection('services'); updateCatalogUrl({ section: 'services', service: 'hidden' }); }}>Ẩn khỏi khách ({hiddenServices.length})</button><button type="button" className="button button-secondary" aria-pressed={serviceFilter === 'archived'} onClick={() => { setServiceFilter('archived'); setActiveSection('services'); updateCatalogUrl({ section: 'services', service: 'archived' }); }}>Đã lưu trữ ({archivedServices.length})</button></div></div>
          <div className="owner-service-list">{visibleServices.map((service) => <article key={service.id} className="owner-service-card">
            <div className="owner-service-row"><div className="owner-service-copy"><strong>{service.name}</strong><span>{service.durationMinutes} phút · {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(service.priceMinor)} · chuẩn bị {service.bufferBeforeMinutes} phút · nghỉ sau {service.bufferAfterMinutes} phút</span><small>{service.active ? 'Đang sử dụng' : 'Đã lưu trữ · không nhận lịch mới'} · {service.active ? service.published ? 'Đang hiện với khách' : 'Đang ẩn với khách' : service.published ? 'Sẽ hiện với khách khi khôi phục' : 'Sẽ tiếp tục ẩn khi khôi phục'}</small></div>
              <div className="owner-service-actions">{service.active && <button type="button" disabled={!canEdit || busy} className="button button-secondary" title={service.published ? 'Khách không thể chọn dịch vụ này; dữ liệu dịch vụ vẫn được giữ.' : 'Hiện dịch vụ trên trang đặt lịch để khách chọn.'} onClick={() => void action(() => api.updateService(tenantId, service.id, { published: !service.published }), service.published ? 'Đã ẩn dịch vụ khỏi khách.' : 'Đã hiện dịch vụ với khách.')}>{service.published ? 'Ẩn khỏi khách' : 'Hiện với khách'}</button>}
                <button type="button" disabled={!canEdit || busy} className="button button-secondary" onClick={() => { if (editingServiceId === service.id) { setEditingServiceId(null); setServiceEditDraft(null); serviceFormAccordionRef.current?.removeAttribute('open'); } else beginServiceEdit(service); }}>{editingServiceId === service.id ? 'Đóng sửa' : 'Sửa'}</button>
                {service.active ? <button type="button" disabled={!canEdit || busy} className="button button-secondary" onClick={() => { if (window.confirm(`Lưu trữ dịch vụ "${service.name}"? Dịch vụ sẽ không nhận lịch mới; hồ sơ và các lịch sử cũ vẫn được giữ.`)) void action(() => api.updateService(tenantId, service.id, { active: false }), 'Đã lưu trữ dịch vụ.'); }}>Lưu trữ</button> : <button type="button" disabled={!canEdit || busy} className="button button-secondary" onClick={() => { if (window.confirm(`Khôi phục dịch vụ "${service.name}"? Dịch vụ sẽ được dùng cho lịch mới và trạng thái hiển thị với khách trước đó sẽ được giữ.`)) void action(() => api.updateService(tenantId, service.id, { active: true }), 'Đã khôi phục dịch vụ.'); }}>Khôi phục</button>}</div>
            </div>
          </article>)}{visibleServices.length === 0 && <p className="owner-service-empty">{serviceFilter === 'active' ? 'Chưa có dịch vụ đang hoạt động.' : serviceFilter === 'hidden' ? 'Không có dịch vụ nào đang ẩn khỏi khách.' : 'Chưa có dịch vụ đã lưu trữ.'}</p>}</div>
        </div>
      </section>

      <section className="surface-card" id="owner-staff" role="region" aria-label="Quản lý nhân viên" hidden={activeSection !== 'staff'}>
        <h2 style={{ marginTop: 0 }}>Đội ngũ & chuyên môn</h2><p className="owner-form-intro">Tạo hồ sơ nhân viên để xếp lịch. Phân quyền tài khoản sẽ được cấu hình ở phần riêng sau.</p>
        <details className="owner-staff-add-accordion"><summary className="owner-staff-add-trigger" aria-label="Mở hoặc thu gọn biểu mẫu thêm nhân viên"><span aria-hidden="true">+</span> Thêm nhân viên</summary><form className="owner-staff-add-form" onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
          const dto: CreateStaffRequest = { name: String(data.get('staffName')).trim(), serviceIds: data.getAll('serviceIds').map(String) };
          if (!dto.name) { setError('Nhập tên nhân viên trước khi thêm.'); return; }
          if (!window.confirm(`Thêm hồ sơ nhân viên “${dto.name}” vào tiệm?`)) return;
          void action(() => api.createStaff(tenantId, dto), 'Đã thêm nhân viên.').then((saved) => { if (saved) { form.reset(); form.closest('details')?.removeAttribute('open'); } });
        }}>
          <label>Tên nhân viên<input name="staffName" required maxLength={160} style={fieldStyle} placeholder="Tên hiển thị"/></label>
          <fieldset className="owner-specialty-picker"><legend>Dịch vụ chuyên môn</legend><p>Chọn các dịch vụ nhân viên có thể đảm nhận khi xếp lịch.</p><div>{services.filter((service) => service.active).map((service) => <label key={service.id}><input name="serviceIds" type="checkbox" value={service.id}/> {service.name}</label>)}</div></fieldset><button disabled={!canEdit || busy} style={buttonStyle}>Thêm nhân viên</button>
        </form></details>
        <div className="owner-staff-list-heading"><strong>{showArchivedStaff ? 'Hồ sơ đã lưu trữ' : 'Nhân viên đang hoạt động'}</strong><div className="owner-staff-list-tabs" role="group" aria-label="Lọc hồ sơ nhân viên"><button type="button" className="button button-secondary" aria-pressed={!showArchivedStaff} onClick={() => { setShowArchivedStaff(false); setActiveSection('staff'); updateCatalogUrl({ section: 'staff', staff: 'active' }); }}>Đang hoạt động ({staff.filter((person) => person.active).length})</button><button type="button" className="button button-secondary" aria-pressed={showArchivedStaff} onClick={() => { setShowArchivedStaff(true); setActiveSection('staff'); updateCatalogUrl({ section: 'staff', staff: 'archived' }); }}>Đã lưu trữ ({staff.filter((person) => !person.active).length})</button></div></div>
        <div className="owner-staff-list">{staff.filter((person) => person.active !== showArchivedStaff).map((person) => <article key={person.id} className="owner-staff-card"><span className="owner-avatar" aria-hidden="true">{person.name.slice(0,1).toUpperCase()}</span><div className="owner-staff-copy"><strong>{person.name}</strong><small>{person.active ? 'Đang nhận lịch' : 'Đã lưu trữ · không xuất hiện trong lựa chọn đặt lịch'}</small><div className="owner-specialty-tags">{services.filter((service) => person.serviceIds.includes(service.id)).map((service) => <span key={service.id}>{service.name}</span>)}{person.serviceIds.length === 0 && <span className="is-muted">Chưa gán chuyên môn</span>}</div></div><div className="owner-staff-actions">{person.active ? <button disabled={!canEdit || busy} className="button button-secondary" onClick={() => { if (window.confirm(`Lưu trữ hồ sơ ${person.name}? Nhân viên sẽ không còn được chọn cho lịch mới.`)) void action(() => api.updateStaff(tenantId, person.id, { active: false }), 'Đã lưu trữ nhân viên.'); }}>Lưu trữ</button> : <button disabled={!canEdit || busy} className="button button-primary" onClick={() => { if (window.confirm(`Khôi phục hồ sơ ${person.name}? Hệ thống sẽ kiểm tra giới hạn nhân viên của gói hiện tại.`)) void action(() => api.updateStaff(tenantId, person.id, { active: true }), 'Đã khôi phục nhân viên.'); }}>Khôi phục hồ sơ</button>}{person.active && <button disabled={!canEdit || busy} className="button button-secondary" onClick={() => {
          if (editingStaffId === person.id) { setEditingStaffId(null); return; }
          setEditingStaffId(person.id);
          setEditingStaffName(person.name);
          setSelectedStaffServiceIds(person.serviceIds);
        }}>{editingStaffId === person.id ? 'Đóng điều chỉnh' : 'Điều chỉnh'}</button>}</div>
        {person.active && editingStaffId === person.id && <div className="staff-service-editor stack-md" aria-label={`Điều chỉnh hồ sơ nhân viên ${person.name}`}>
          <label className="field-group">Tên nhân viên<input required maxLength={160} value={editingStaffName} onChange={(event) => setEditingStaffName(event.target.value)} style={fieldStyle}/></label>
          <p className="helper-text">Chọn các dịch vụ chuyên môn mà nhân viên này có thể phục vụ.</p>
          <div className="staff-service-options">{services.filter((service) => service.active).map((service) => <label key={service.id}><input type="checkbox" checked={selectedStaffServiceIds.includes(service.id)} onChange={(event) => setSelectedStaffServiceIds((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id))}/> {service.name}</label>)}</div>
          <div className="action-row"><button className="button button-primary" disabled={!canEdit || busy} onClick={() => void saveStaffDetails(person)}>Lưu điều chỉnh</button><button className="button button-secondary" disabled={busy} onClick={() => setEditingStaffId(null)}>Hủy</button></div>
        </div>}
      </article>)}{staff.filter((person) => person.active !== showArchivedStaff).length === 0 && <p className="owner-empty">{showArchivedStaff ? 'Chưa có hồ sơ lưu trữ để khôi phục.' : staff.length ? 'Chưa có nhân viên đang hoạt động.' : 'Chưa có nhân viên.'}</p>}</div>
      </section>

      <section className="owner-hours-section" id="owner-hours" role="region" aria-label="Giờ làm và xếp ca" hidden={activeSection !== 'hours'}>
        <section className="surface-card owner-hours-card" aria-labelledby="owner-business-hours-title">
        <h2 id="owner-business-hours-title" style={{ marginTop: 0 }}>Giờ mở cửa của tiệm</h2><p className="owner-form-intro">Thiết lập đủ 7 ngày rồi lưu một lần. Thêm nhiều khoảng giờ trong ngày để ghi rõ giờ nghỉ giữa ca; để trống khoảng giờ nếu tiệm nghỉ cả ngày.</p>
        <form className="owner-business-week-form" onSubmit={(event) => void saveBusinessWeek(event)}><details className="owner-business-hours-accordion"><summary><span><strong>Giờ mở cửa cả tuần</strong><small>{businessOpenDays} ngày mở cửa · {businessIntervalCount} khung giờ</small></span><span className="owner-business-chevron" aria-hidden="true">⌄</span></summary><div className="owner-business-week-grid">{Array.from({ length: 7 }, (_, weekday) => {
          const intervals = businessIntervalsByDay[weekday] ?? [];
          const summary = intervals.length ? `${intervals[0].localStart.slice(0, 5)}–${intervals[intervals.length - 1].localEnd.slice(0, 5)} · ${intervals.length} khung` : 'Đóng cửa';
          return <details className={`owner-business-day${weekday === 0 ? ' is-sunday' : ''}`} key={weekday}><summary><span className="owner-business-day-heading"><strong>{weekdays[weekday]}</strong><small className={intervals.length ? 'is-open' : 'is-closed'}>{summary}</small></span><span className="owner-business-chevron" aria-hidden="true">⌄</span></summary><div className="owner-business-intervals">{intervals.map((interval, index) => <div className="owner-business-interval" key={index}><label>Từ<input type="time" required value={interval.localStart} onChange={(event) => setBusinessIntervalsByDay((current) => ({ ...current, [weekday]: intervals.map((row, rowIndex) => rowIndex === index ? { ...row, localStart: event.target.value } : row) }))}/></label><label>Đến<input type="time" required value={interval.localEnd} onChange={(event) => setBusinessIntervalsByDay((current) => ({ ...current, [weekday]: intervals.map((row, rowIndex) => rowIndex === index ? { ...row, localEnd: event.target.value } : row) }))}/></label><button type="button" aria-label={`Xóa khoảng giờ ${index + 1} ngày ${weekdays[weekday]}`} onClick={() => setBusinessIntervalsByDay((current) => ({ ...current, [weekday]: intervals.filter((_, rowIndex) => rowIndex !== index) }))}>Xóa</button></div>)}<button type="button" className="owner-add-interval" onClick={() => setBusinessIntervalsByDay((current) => ({ ...current, [weekday]: [...intervals, { localStart: '', localEnd: '' }] }))}>+ Thêm khoảng giờ</button></div></details>;
        })}<div className="owner-form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setBusinessIntervalsByDay(Object.fromEntries(Array.from({ length: 7 }, (_, weekday) => [weekday, intervalsFromRows(businessHours, weekday)])))}>Hoàn tác thay đổi</button><button className="button button-primary" disabled={!canEdit || busy}>{busy ? 'Đang lưu…' : 'Lưu giờ cả tuần'}</button></div></div></details></form>
        </section>
        <section className="surface-card owner-hours-card owner-staff-schedule" aria-labelledby="owner-shift-matrix-title"><header className="owner-panel-heading owner-staff-schedule-heading"><div><h2 id="owner-shift-matrix-title">Ma trận ca làm</h2><p>Chọn ô nhân viên và ngày để thiết lập ca lặp theo thứ. Tổng giờ tháng cộng các ca lặp theo số lần từng thứ xuất hiện.</p></div><div className="owner-schedule-controls"><input className="owner-schedule-search" aria-label="Tìm nhân viên" value={staffScheduleSearch} onChange={(event) => setStaffScheduleSearch(event.target.value)} placeholder="Tìm nhân viên"/><div className="owner-calendar-view-switch"><button type="button" aria-pressed={staffScheduleMode === 'week'} onClick={() => { setStaffScheduleMode('week'); setActiveSection('hours'); updateCatalogUrl({ section: 'hours', schedule: 'week' }); }}>Tuần</button><button type="button" aria-pressed={staffScheduleMode === 'month'} onClick={() => { setStaffScheduleMode('month'); setActiveSection('hours'); updateCatalogUrl({ section: 'hours', schedule: 'month' }); }}>Tháng</button></div>{staffScheduleMode === 'week' ? <div className="owner-schedule-week-picker"><label><span className="sr-only">Chọn ngày thuộc tuần cần xem</span><input aria-label="Chọn ngày trong tuần" title={`Tuần ${shortDate(scheduleWeekStart)} – ${shortDate(shiftDateValue(scheduleWeekStart, 6))}`} type="date" value={staffScheduleWeekDate} onChange={(event) => { if (!event.target.value) return; setStaffScheduleWeekDate(event.target.value); updateCatalogUrl({ section: 'hours', schedule: 'week', week: event.target.value }); }}/></label></div> : <input className="owner-schedule-month-picker" aria-label="Chọn tháng" type="month" value={staffScheduleMonth} onChange={(event) => { if (!event.target.value) return; setStaffScheduleMonth(event.target.value); updateCatalogUrl({ section: 'hours', schedule: 'month', month: event.target.value }); }}/>}</div></header>
          <div id="owner-shift-template-manager" className="owner-shift-template-manager">
            <div className="owner-shift-template-toolbar"><div><strong>Ca cố định</strong><small>{staffShiftTemplates.length ? `${staffShiftTemplates.length} ca dùng chung khi xếp lịch` : 'Tạo ca mẫu để xếp lịch nhanh và chính xác hơn'}</small></div>{canEdit && <button type="button" className="button button-primary" onClick={() => beginShiftTemplateEdit()}>+ Tạo ca cố định</button>}</div>
            {staffShiftTemplates.length > 0 ? <details className="owner-shift-template-saved"><summary>Danh sách ca đã tạo · {staffShiftTemplates.length}</summary><div className="owner-shift-template-list">{staffShiftTemplates.map((template) => <article className="owner-shift-template-row" key={template.id}><div><strong>{template.name}</strong><span>{template.intervals.map((interval) => `${interval.localStart.slice(0, 5)}–${interval.localEnd.slice(0, 5)}`).join(' · ')}</span></div>{canEdit && <div><button type="button" className="button button-secondary" onClick={() => beginShiftTemplateEdit(template)}>Sửa</button></div>}</article>)}</div></details> : <p className="owner-empty">Chưa có ca cố định. Tạo ca gồm một hoặc nhiều khoảng giờ; khi cập nhật ca, lịch đã xếp không bị thay đổi.</p>}
          </div>
          {shiftTemplateEditorOpen && typeof document !== 'undefined' && createPortal(<div className="owner-shift-template-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeShiftTemplateEditor(); }}><form ref={shiftTemplateModalRef} className="owner-shift-template-modal" role="dialog" aria-modal="true" aria-labelledby="owner-shift-template-modal-title" onSubmit={(event) => void saveShiftTemplate(event)} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h2 id="owner-shift-template-modal-title">{editingShiftTemplateId ? 'Chỉnh sửa ca cố định' : 'Tạo ca cố định'}</h2><p>Mẫu ca dùng để xếp nhanh cho nhân viên. Thay đổi mẫu không làm đổi lịch đã xếp.</p></div><button type="button" className="owner-shift-popover-close" aria-label="Đóng biểu mẫu ca cố định" onClick={closeShiftTemplateEditor}>×</button></header>
            {error && <p className="owner-shift-template-modal-error" role="alert">{error}</p>}
            <label>Tên ca<input autoFocus maxLength={80} required value={shiftTemplateDraft.name} onChange={(event) => { setShiftTemplateDraftDirty(true); setShiftTemplateDraft((draft) => ({ ...draft, name: event.target.value })); }} placeholder="Ví dụ: Ca sáng"/></label>
            <div className="owner-shift-template-intervals">{shiftTemplateDraft.intervals.map((interval, index) => <div className="owner-shift-template-interval" key={index}><span>Khoảng {index + 1}</span><label>Từ<input type="time" required value={interval.localStart} onChange={(event) => { setShiftTemplateDraftDirty(true); setShiftTemplateDraft((draft) => ({ ...draft, intervals: draft.intervals.map((row, rowIndex) => rowIndex === index ? { ...row, localStart: event.target.value } : row) })); }}/></label><label>Đến<input type="time" required value={interval.localEnd} onChange={(event) => { setShiftTemplateDraftDirty(true); setShiftTemplateDraft((draft) => ({ ...draft, intervals: draft.intervals.map((row, rowIndex) => rowIndex === index ? { ...row, localEnd: event.target.value } : row) })); }}/></label><button type="button" className="button button-secondary" disabled={shiftTemplateDraft.intervals.length === 1} onClick={() => { setShiftTemplateDraftDirty(true); setShiftTemplateDraft((draft) => ({ ...draft, intervals: draft.intervals.filter((_, rowIndex) => rowIndex !== index) })); }}>Xóa</button></div>)}</div>
            <button type="button" className="button button-secondary owner-shift-template-add-interval" disabled={shiftTemplateDraft.intervals.length >= 8} onClick={() => { setShiftTemplateDraftDirty(true); setShiftTemplateDraft((draft) => ({ ...draft, intervals: [...draft.intervals, { localStart: '', localEnd: '' }] })); }}>+ Thêm khoảng giờ</button>
            <footer><button type="button" className="button button-secondary" onClick={closeShiftTemplateEditor}>Hủy</button><button className="button button-primary" disabled={busy}>{busy ? 'Đang lưu…' : editingShiftTemplateId ? 'Lưu thay đổi ca' : 'Lưu ca cố định'}</button></footer>
          </form></div>, document.body)}
          <div className="owner-staff-matrix-scroll"><table className="owner-staff-matrix"><thead><tr><th>Nhân viên</th>{scheduleColumns.map((column) => <th key={column.date}>{column.label}</th>)}<th>{staffScheduleMode === 'week' ? 'Tổng giờ/tuần' : 'Tổng giờ/tháng'}</th></tr></thead><tbody>{activeStaff.filter((person) => person.name.toLocaleLowerCase('vi-VN').includes(staffScheduleSearch.trim().toLocaleLowerCase('vi-VN'))).map((person) => { const rows = staffHoursById[person.id] ?? []; return <tr key={person.id}><th scope="row">{person.name}</th>{scheduleColumns.map((column) => { const intervals = rows.filter((row) => row.weekday === column.day); return <td key={column.date}><button type="button" className={`owner-staff-matrix-cell${intervals.length ? '' : ' is-unassigned'}`} onClick={(event) => { if (scheduleAnchor === event.currentTarget && scheduleCellOpen) { closeScheduleEditor(); return; } setStaffIdForHours(person.id); setStaffDay(column.day); setStaffIntervals(intervalsFromRows(rows, column.day)); setSelectedShiftTemplateId(''); setManualStaffHours(false); setScheduleDraftDirty(false); setSchedulePopoverPosition(null); setScheduleAnchor(event.currentTarget); setScheduleCellOpen(true); }}><span>{intervals.length ? intervals.map((item) => `${item.localStart.slice(0,5)}–${item.localEnd.slice(0,5)}`).join(' · ') : 'Chưa xếp ca'}</span></button></td>; })}<td className="owner-staff-total">{totalScheduleHours(rows).toLocaleString('vi-VN',{maximumFractionDigits:1})}h</td></tr>; })}{activeStaff.filter((person) => person.name.toLocaleLowerCase('vi-VN').includes(staffScheduleSearch.trim().toLocaleLowerCase('vi-VN'))).length === 0 && <tr><td colSpan={scheduleColumns.length + 2}>Không có hồ sơ nhân viên trong khoảng xem này.</td></tr>}</tbody></table></div>
          {scheduleCellOpen && staffIdForHours && scheduleAnchor && typeof document !== 'undefined' && createPortal(<form ref={schedulePopoverRef} role="dialog" aria-modal="false" aria-labelledby="owner-shift-popover-title" className="owner-staff-shift-editor" style={{ left: schedulePopoverPosition?.left ?? 0, top: schedulePopoverPosition?.top ?? 0, visibility: schedulePopoverPosition ? 'visible' : 'hidden' }} onSubmit={(event) => void saveStaffDay(event)}><header className="owner-shift-popover-heading"><div><strong id="owner-shift-popover-title">{staff.find((person) => person.id === staffIdForHours)?.name} · {weekdays[staffDay]}</strong><p>Ca lặp lại hằng tuần. Lịch được lưu riêng cho nhân viên và ngày này.</p></div><button type="button" className="owner-shift-popover-close" aria-label="Đóng phần xếp ca" onClick={closeScheduleEditor}>×</button></header>
            {error && <p className="owner-shift-inline-error" role="alert">{error}</p>}
            {!manualStaffHours ? <div className="owner-shift-assignment"><label>Chọn ca cố định<select value={selectedShiftTemplateId} disabled={!canEdit || busy || !staffShiftTemplates.length} onChange={(event) => { const id = event.target.value; const template = staffShiftTemplates.find((item) => item.id === id); setSelectedShiftTemplateId(id); setScheduleDraftDirty(true); if (template) setStaffIntervals(template.intervals.map((interval) => ({ localStart: interval.localStart.slice(0, 5), localEnd: interval.localEnd.slice(0, 5) }))); }}><option value="">{staffShiftTemplates.length ? 'Chọn ca…' : 'Chưa có ca mẫu'}</option>{staffShiftTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} · {template.intervals.map((interval) => `${interval.localStart.slice(0, 5)}–${interval.localEnd.slice(0, 5)}`).join(' / ')}</option>)}</select></label><button type="button" className="button button-secondary" disabled={!canEdit || busy} onClick={() => setManualStaffHours(true)}>Nhập thủ công</button>{!staffShiftTemplates.length && canEdit && <button type="button" className="button button-secondary" onClick={() => { beginShiftTemplateEdit(); document.getElementById('owner-shift-template-manager')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Tạo ca cố định</button>}</div> : <><div className="owner-shift-manual-heading"><strong>Nhập giờ thủ công</strong><button type="button" className="button button-secondary" disabled={!canEdit || busy} onClick={() => { setManualStaffHours(false); setSelectedShiftTemplateId(''); }}>Chọn ca cố định</button></div><div className="time-range-list">{staffIntervals.map((interval, index) => <div className="time-range-row" key={index}><label>Từ<input type="time" required value={interval.localStart} onChange={(event) => { setScheduleDraftDirty(true); setStaffIntervals((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, localStart: event.target.value } : row)); }}/></label><label>Đến<input type="time" required value={interval.localEnd} onChange={(event) => { setScheduleDraftDirty(true); setStaffIntervals((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, localEnd: event.target.value } : row)); }}/></label><button type="button" className="button button-secondary" disabled={!canEdit || busy} onClick={() => { setScheduleDraftDirty(true); setStaffIntervals((rows) => rows.filter((_, rowIndex) => rowIndex !== index)); }}>Xóa</button></div>)}</div><button type="button" className="button button-secondary" disabled={!canEdit || busy} onClick={() => { setScheduleDraftDirty(true); setStaffIntervals((rows) => [...rows, { localStart: '', localEnd: '' }]); }}>+ Thêm khoảng giờ</button></>}
            {scheduleConfirmationOpen ? <div className="owner-shift-confirmation" role="group" aria-label="Xác nhận ca làm"><strong>Xác nhận xếp ca?</strong><span>{staff.find((person) => person.id === staffIdForHours)?.name} · {weekdays[staffDay]} · {staffIntervals.length ? staffIntervals.map((interval) => `${interval.localStart}–${interval.localEnd}`).join(' / ') : 'Không có giờ làm'}</span><div><button type="button" className="button button-secondary" disabled={busy} onClick={() => setScheduleConfirmationOpen(false)}>Quay lại</button><button type="button" className="button button-primary" disabled={!canEdit || busy} onClick={() => void confirmSaveStaffDay()}>{busy ? 'Đang lưu…' : 'Xác nhận xếp ca'}</button></div></div> : <div className="owner-form-actions"><button type="submit" className="button button-primary" disabled={!canEdit || busy || (!manualStaffHours && !selectedShiftTemplateId)}>{busy ? 'Đang lưu…' : manualStaffHours ? 'Lưu giờ thủ công' : 'Xếp ca cố định'}</button></div>}</form>, document.body)}
        </section>
      </section>

      <section className="surface-card" id="owner-exceptions" role="region" aria-label="Ngoại lệ lịch làm" hidden={activeSection !== 'policies-exceptions'}>
        <h2 style={{ marginTop: 0 }}>Ngoại lệ lịch</h2><p className="owner-form-intro">Dùng ngoại lệ cho ngày nghỉ, nghỉ giữa buổi hoặc mở cửa thêm một ngày. Ngoại lệ có phạm vi địa điểm hoặc một nhân viên, và không xóa lịch sử đã tạo.</p>
        <form className="owner-exception-form" onSubmit={(event) => void submitException(event)}>
          <label className="owner-exception-field"><span><strong>Phạm vi áp dụng</strong><small>Chọn đóng/mở lịch cho toàn tiệm hoặc chỉ một nhân viên.</small></span><select style={fieldStyle} value={exceptionScope} onChange={(e) => setExceptionScope(e.target.value as 'location' | 'staff')}><option value="location">Toàn tiệm</option><option value="staff">Một nhân viên</option></select></label>
          {exceptionScope === 'staff' && <label className="owner-exception-field"><span><strong>Nhân viên</strong><small>Ngoại lệ chỉ tác động đến lịch của người được chọn.</small></span><select required style={fieldStyle} value={exceptionStaffId} onChange={(e) => setExceptionStaffId(e.target.value)}><option value="">Chọn nhân viên</option>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
          <label className="owner-exception-field"><span><strong>Ngày áp dụng</strong><small>Chọn ngày cụ thể tiệm nghỉ hoặc mở thêm giờ.</small></span><input required type="date" style={fieldStyle} value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)}/></label>
          <div className="owner-exception-field"><span><strong>Khoảng thời gian</strong><small>Chọn giờ bắt đầu và kết thúc. Có thể tạo nhiều ngoại lệ nếu cần chia ca.</small></span><div className="owner-exception-time"><label><span className="sr-only">Giờ bắt đầu</span><input required aria-label="Giờ bắt đầu" type="time" style={fieldStyle} value={exceptionStart} onChange={(e) => setExceptionStart(e.target.value)}/></label><span>đến</span><label><span className="sr-only">Giờ kết thúc</span><input required aria-label="Giờ kết thúc" type="time" style={fieldStyle} value={exceptionEnd} onChange={(e) => setExceptionEnd(e.target.value)}/></label></div></div>
          <label className="owner-exception-field"><span><strong>Loại ngoại lệ</strong><small>Đánh dấu thời gian không nhận lịch hoặc mở thêm khung giờ ngoài lịch thường lệ.</small></span><select style={fieldStyle} value={exceptionKind} onChange={(e) => setExceptionKind(e.target.value as 'unavailable' | 'available')}><option value="unavailable">Nghỉ / không nhận lịch</option><option value="available">Mở thêm giờ</option></select></label>
          <label className="owner-exception-field"><span><strong>Lý do</strong><small>Ghi chú để mọi người trong tiệm hiểu ngoại lệ này được tạo vì việc gì.</small></span><input maxLength={500} style={fieldStyle} value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="Ví dụ: nghỉ lễ, họp tiệm"/></label>
          <div className="owner-form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm('Đặt lại các thông tin ngoại lệ đang nhập?')) resetExceptionForm(); }}>Đặt lại</button><button className="button button-primary" disabled={!canEdit || busy || (exceptionScope === 'staff' && !exceptionStaffId)}>{busy ? 'Đang lưu…' : 'Lưu ngoại lệ'}</button></div>
        </form>
        <div className="owner-exception-list">{exceptions.map((exception) => <article key={exception.id} className="owner-exception-row"><div><strong>{exception.onDate} · {exception.localStart.slice(0, 5)}–{exception.localEnd.slice(0, 5)}</strong><small>{exception.scope === 'location' ? 'Toàn tiệm' : staff.find((person) => person.id === exception.staffId)?.name || 'Nhân viên'} · {exception.kind === 'unavailable' ? 'Nghỉ / không nhận lịch' : 'Mở thêm giờ'}{exception.reason ? ` · ${exception.reason}` : ''}</small></div><span className={`owner-exception-status${exception.active ? ' is-active' : ''}`}>{exception.active ? 'Đang áp dụng' : 'Đã tắt'}</span>{exception.active && <button type="button" disabled={!canEdit || busy} className="button button-secondary" onClick={() => { if (window.confirm('Tắt ngoại lệ này? Lịch sử vẫn được giữ lại.')) void action(() => api.deactivateScheduleException(tenantId, exception.id), 'Đã vô hiệu hóa ngoại lệ.'); }}>Tắt ngoại lệ</button>}</article>)}{exceptions.length === 0 && <p className="owner-empty">Chưa có ngoại lệ nào được thiết lập.</p>}</div>
      </section>
    </div>
  </main>;
}
