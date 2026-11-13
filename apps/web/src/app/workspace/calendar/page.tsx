'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AvailabilitySlotDto, BookingDto, BookingScheduleSuggestionDto, TenantContextDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';

const field: React.CSSProperties = { width: '100%', padding: '0.65rem 0.75rem', border: '1px solid var(--line)', borderRadius: '0.55rem', background: '#fff', color: 'var(--ink)', font: 'inherit' };
const button: React.CSSProperties = { padding: '0.6rem 0.8rem', border: 0, borderRadius: '0.5rem', color: '#fff', background: 'var(--accent)', fontWeight: 700, cursor: 'pointer' };

function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function dateStringInTimezone(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function localDayDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day, 12); }
function zonedInstant(date: string, hour: number, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour);
  let instant = desired;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const difference = desired - represented;
    if (difference === 0) break;
    instant += difference;
  }
  return new Date(instant);
}

export default function BookingCalendarPage() {
  const router = useRouter();
  const query = useSearchParams();
  const datePickerRef = useRef<HTMLInputElement>(null);
  const requestedView = query.get('view');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [date, setDate] = useState(query.get('date') || dateString(new Date()));
  const [mode, setMode] = useState<'day' | 'week' | 'month'>(requestedView === 'day' || requestedView === 'week' || requestedView === 'month' ? requestedView : 'day');
  const [staffFilter, setStaffFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState('');
  const [bookings, setBookings] = useState<BookingDto[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rescheduleId, setRescheduleId] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [rescheduleSuggestions, setRescheduleSuggestions] = useState<BookingScheduleSuggestionDto[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [clockNow, setClockNow] = useState<number | null>(null);

  useEffect(() => {
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const range = useMemo(() => {
    const weekOffset = mode === 'week' ? (new Date(`${date}T12:00:00`).getDay() + 6) % 7 : 0;
    const firstOfMonth = `${date.slice(0, 7)}-01`;
    const fromDate = mode === 'month' ? firstOfMonth : mode === 'week' ? addDays(date, -weekOffset) : date;
    const nextMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const toDate = mode === 'month' ? nextMonth : addDays(fromDate, mode === 'week' ? 7 : 1);
    return { fromDate, toDate };
  }, [date, mode]);

  const load = useCallback(async (activeTenant: string, tenantContext: TenantContextDto, from: string, to: string) => {
    setLoading(true); setError('');
    try {
      const [start, end] = await Promise.all([
        Promise.resolve(zonedInstant(from, 0, tenantContext.location.timezone).toISOString()),
        Promise.resolve(zonedInstant(to, 0, tenantContext.location.timezone).toISOString()),
      ]);
      const [bookingRows, staffRows] = await Promise.all([
        api.listBookings(activeTenant, start, end),
        api.listStaff(activeTenant),
      ]);
      setBookings(bookingRows);
      setStaffNames(Object.fromEntries(staffRows.map((person) => [person.id, person.name])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được lịch đặt.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const savedTenant = localStorage.getItem('sbc_tenant_id');
    if (!savedTenant) { router.replace('/login'); return; }
    setTenantId(savedTenant);
    api.getCurrentTenant(savedTenant).then((current) => {
      setContext(current);
      if (!['owner', 'admin', 'receptionist'].includes(current.role)) {
        setError('Vai trò hiện tại không có quyền xem lịch đặt.');
        setLoading(false);
      }
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Không tải được tổ chức.');
      setLoading(false);
    });
  // Range changes are handled by the next effect after tenant context is loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (tenantId && context && ['owner', 'admin', 'receptionist'].includes(context.role)) {
      void load(tenantId, context, range.fromDate, range.toDate);
    }
  }, [tenantId, context, range.fromDate, range.toDate, load]);

  useEffect(() => {
    const requestedDate = query.get('date'); const requestedMode = query.get('view');
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setDate(requestedDate);
    if (requestedMode === 'day' || requestedMode === 'week' || requestedMode === 'month') setMode(requestedMode);
  }, [query]);

  useEffect(() => {
    const bookingId = query.get('bookingId');
    if (!bookingId || loading || !context) return;
    const target = bookings.find((booking) => booking.id === bookingId);
    if (!target) return;
    const targetDay = dateStringInTimezone(new Date(target.startsAt), context.location.timezone);
    setDate(targetDay);
    setMode('day');
    setSelectedDay('');
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        document.getElementById(`booking-${bookingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [bookings, context, loading, query]);

  useEffect(() => {
    if (!selectedDay && !selectedBookingId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedDay(''); setSelectedBookingId(''); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedDay, selectedBookingId]);

  async function runAction(booking: BookingDto, action: 'approve' | 'cancel' | 'complete' | 'no-show') {
    if (!tenantId) return;
    if (action === 'cancel' && !window.confirm('Bạn muốn hủy lịch đặt này?')) return;
    setBusy(true); setError(''); setMessage('');
    try { await api.bookingAction(tenantId, booking.id, action); setMessage('Đã cập nhật trạng thái lịch đặt.'); await load(tenantId, context!, range.fromDate, range.toDate); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không cập nhật được lịch đặt.'); }
    finally { setBusy(false); }
  }

  async function fetchRescheduleSlots(booking: BookingDto, nextDate: string) {
    setRescheduleDate(nextDate); setSelectedSlot(''); setSlots([]); setRescheduleSuggestions([]); setError('');
    if (!tenantId || !nextDate) return;
    try {
      if (booking.serviceSnapshot.services && booking.serviceSnapshot.services.length > 1 && context?.tenant.slug) {
        const serviceIds = booking.serviceSnapshot.services.map((service) => service.id);
        setRescheduleSuggestions(await api.publicBookingSuggestions(context.tenant.slug, serviceIds, nextDate, {}));
      } else {
        setSlots(await api.bookingAvailability(tenantId, booking.serviceId, nextDate));
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được giờ trống.'); }
  }

  async function saveReschedule(booking: BookingDto) {
    if (!tenantId || !selectedSlot) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const isMultiService = (booking.serviceSnapshot.services?.length ?? 0) > 1;
      const suggestion = isMultiService ? rescheduleSuggestions.find((item) => item.startsAt === selectedSlot) : undefined;
      if (isMultiService && !suggestion) throw new Error('Gợi ý đổi lịch không còn hợp lệ. Hãy tải lại giờ trống.');
      await api.rescheduleBooking(tenantId, booking.id, { startsAt: selectedSlot, staffSelection: 'ANY_AVAILABLE', ...(suggestion ? { serviceAssignments: suggestion.segments.map(({ serviceId, staffId, startsAt }) => ({ serviceId, staffId, startsAt })) } : {}) });
      setRescheduleId(''); setMessage('Đã đổi thời gian lịch đặt.'); await load(tenantId, context!, range.fromDate, range.toDate);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không đổi được lịch đặt.'); }
    finally { setBusy(false); }
  }

  function actionsFor(booking: BookingDto) {
    const hasStarted = clockNow !== null && Date.parse(booking.startsAt) <= clockNow;
    if (booking.status === 'PENDING') return <>
      <button className="button button-primary" disabled={busy} onClick={() => void runAction(booking, 'approve')}>Xác nhận</button>
      <button className="button button-secondary" disabled={busy || hasStarted} title={hasStarted ? 'Lịch đã bắt đầu nên không thể đổi giờ.' : undefined} onClick={() => setRescheduleId(rescheduleId === booking.id ? '' : booking.id)}>Đổi giờ</button>
      <button className="button button-danger" disabled={busy} onClick={() => void runAction(booking, 'cancel')}>Hủy</button>
    </>;
    if (booking.status === 'CONFIRMED') return <>
      <button className="button button-primary" disabled={busy || !hasStarted} title={!hasStarted ? 'Chỉ có thể hoàn tất từ giờ bắt đầu lịch hẹn.' : 'Đánh dấu hoàn tất khi khách đã dùng dịch vụ xong.'} onClick={() => void runAction(booking, 'complete')}>Hoàn tất</button>
      <button className="button button-secondary" disabled={busy || hasStarted} title={hasStarted ? 'Lịch đã bắt đầu nên không thể đổi giờ.' : undefined} onClick={() => setRescheduleId(rescheduleId === booking.id ? '' : booking.id)}>Đổi giờ</button>
      <button className="button button-secondary" disabled={busy || !hasStarted} onClick={() => void runAction(booking, 'no-show')}>Vắng mặt</button>
      <button className="button button-danger" disabled={busy} onClick={() => void runAction(booking, 'cancel')}>Hủy</button>
    </>;
    return null;
  }

  const bookingsByDay = useMemo(() => {
    const groups: Record<string, BookingDto[]> = {};
    const timezone = context?.location.timezone || 'UTC';
    const dayFormatter = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
    for (const booking of bookings) {
      if (staffFilter !== 'all' && booking.staffId !== staffFilter) continue;
      if (statusFilter !== 'all' && booking.status !== statusFilter) continue;
      if (normalizedSearch && ![booking.customerName, booking.customerEmail ?? '', booking.customerPhone ?? '', booking.serviceSnapshot.name].some((value) => value.toLocaleLowerCase('vi-VN').includes(normalizedSearch))) continue;
      const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(booking.startsAt)).map((part) => [part.type, part.value]));
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      (groups[day] ??= []).push(booking);
    }
    return groups;
  }, [bookings, context?.location.timezone, staffFilter, statusFilter, search]);

  const statusLabel: Record<BookingDto['status'], string> = { PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', CANCELLED: 'Đã hủy', COMPLETED: 'Hoàn tất', NO_SHOW: 'Vắng mặt', EXPIRED: 'Đã hết hạn' };
  const statusTone: Record<BookingDto['status'], string> = { PENDING: 'status-pill-warning', CONFIRMED: 'status-pill-success', CANCELLED: 'status-pill-danger', COMPLETED: 'status-pill-success', NO_SHOW: 'status-pill-danger', EXPIRED: 'status-pill-danger' };
  const pendingCount = bookings.filter((booking) => booking.status === 'PENDING').length;
  const confirmedCount = bookings.filter((booking) => booking.status === 'CONFIRMED').length;
  const completedCount = bookings.filter((booking) => booking.status === 'COMPLETED').length;
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) ?? null;
  const businessToday = context ? dateStringInTimezone(new Date(), context.location.timezone) : dateString(new Date());
  const calendarDays = useMemo(() => {
    const count = mode === 'week' ? 7 : 1;
    return Array.from({ length: count }, (_, index) => addDays(range.fromDate, index));
  }, [mode, range.fromDate]);
  const monthLength = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const monthOffset = (new Date(`${date.slice(0, 7)}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const monthCells = Array.from({ length: Math.ceil((monthOffset + monthLength) / 7) * 7 }, (_, index) => index - monthOffset + 1);
  const visibleBookings = Object.values(bookingsByDay).flat();
  const monthTitle = new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(new Date(`${date.slice(0, 7)}-15T12:00:00`));
  const periodLabel = mode === 'month' ? monthTitle : mode === 'week' ? `${formatWorkspaceDate(range.fromDate)} – ${formatWorkspaceDate(addDays(range.toDate, -1))}` : formatWorkspaceDate(date);
  const movePeriod = (direction: number) => {
    const next = mode === 'month' ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + direction, 15)) : new Date(`${addDays(date, direction * (mode === 'week' ? 7 : 1))}T12:00:00Z`);
    const nextDate = next.toISOString().slice(0, 10); setDate(nextDate);
    router.replace(`/workspace/calendar?view=${mode}&date=${nextDate}`);
  };
  function openDatePicker() {
    const input = datePickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    try {
      if (input.showPicker) input.showPicker();
      else { input.focus(); input.click(); }
    } catch {
      input.focus(); input.click();
    }
  }
  function selectMode(nextMode: 'day' | 'week' | 'month') { setMode(nextMode); router.replace(`/workspace/calendar?view=${nextMode}&date=${date}`); }

  function renderBookingCard(booking: BookingDto) {
    const bookingActions = actionsFor(booking);
    const isOngoing = booking.status === 'CONFIRMED' && clockNow !== null && Date.parse(booking.startsAt) <= clockNow && clockNow < Date.parse(booking.endsAt);
    return <article id={`booking-${booking.id}`} key={booking.id} className={`calendar-booking${isOngoing ? ' is-ongoing' : ''}${query.get('bookingId') === booking.id ? ' is-notification-target' : ''}`}>
      <header className="calendar-booking-card-heading"><h3 className="calendar-booking-title">{booking.serviceSnapshot.name}</h3><button type="button" className="calendar-booking-detail-trigger" onClick={() => { setSelectedDay(''); setSelectedBookingId(booking.id); }}>Chi tiết</button></header>
      <p className="calendar-booking-time">{new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(booking.startsAt))} – {new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(booking.endsAt))}</p>
      <div className="calendar-booking-details"><span>{booking.customerName}</span><span>{booking.customerPhone ?? 'Không có số điện thoại'}</span>{booking.customerEmail && <span>{booking.customerEmail}</span>}{booking.serviceAssignments?.length ? <div className="calendar-booking-segments">{booking.serviceAssignments.map((segment) => { const service = booking.serviceSnapshot.services?.find((item) => item.id === segment.serviceId); return <div key={`${booking.id}-${segment.segmentIndex}`}><strong>{service?.name ?? booking.serviceSnapshot.name}</strong><span>{new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(segment.startsAt))}–{new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(segment.endsAt))} · {staffNames[segment.staffId] || 'Không rõ nhân viên'}</span></div>; })}</div> : <span>Nhân viên: {staffNames[booking.staffId] || 'Không rõ'}</span>}{booking.customerNote && <span className="calendar-booking-customer-note">Ghi chú khách: {booking.customerNote}</span>}</div>
      <div className="calendar-booking-status"><span className={`status-pill ${statusTone[booking.status]}`}>{statusLabel[booking.status]}</span>{isOngoing && <span className="calendar-booking-live">Đang diễn ra</span>}</div>
      {bookingActions && <div className="calendar-booking-actions">{bookingActions}</div>}
      {rescheduleId === booking.id && <div className="calendar-reschedule form-grid">
        <label className="field-group">Ngày mới<input type="date" value={rescheduleDate} onChange={(e) => void fetchRescheduleSlots(booking, e.target.value)} style={field} /></label>
        <label className="field-group">Giờ mới<select value={selectedSlot} onChange={(e) => setSelectedSlot(e.target.value)} style={field}><option value="">Chọn giờ trống</option>{(booking.serviceSnapshot.services?.length ?? 0) > 1 ? rescheduleSuggestions.map((item) => <option key={item.startsAt} value={item.startsAt}>{item.localStart} · {item.segments.length}/{booking.serviceSnapshot.services?.length} dịch vụ</option>) : slots.map((item) => <option key={item.startsAt} value={item.startsAt}>{item.localStart}</option>)}</select></label>
        <button className="button button-primary" disabled={busy || !selectedSlot} onClick={() => void saveReschedule(booking)}>Lưu giờ mới</button>
      </div>}
    </article>;
  }

  function renderDayCards(day: string) {
    return [...(bookingsByDay[day] ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).map(renderBookingCard);
  }

  return <main className="owner-page owner-calendar"><div className="app-container">
    <header className="owner-page-heading"><h1>Lịch của tiệm</h1></header>
    {!loading && !error && <div className="owner-calendar-summary" aria-label="Tóm tắt lịch trong khoảng xem"><span><b>{pendingCount}</b> Chờ xác nhận</span><span><b>{confirmedCount}</b> Đã xác nhận</span><span><b>{completedCount}</b> Hoàn tất</span></div>}
    <section className="owner-calendar-controls" aria-label="Bộ lọc và điều khiển lịch">
      <div className="owner-calendar-filter-panel">
        <div className="owner-calendar-filter-row"><label className="owner-calendar-search"><span className="sr-only">Tìm khách hoặc dịch vụ</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm khách, email hoặc dịch vụ" /></label>
          <label><span className="sr-only">Lọc nhân viên</span><select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}><option value="all">Tất cả nhân viên</option>{Object.entries(staffNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span className="sr-only">Lọc trạng thái</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="PENDING">Chờ xác nhận</option><option value="CONFIRMED">Đã xác nhận</option><option value="COMPLETED">Hoàn tất</option><option value="CANCELLED">Đã hủy</option><option value="NO_SHOW">Vắng mặt</option><option value="EXPIRED">Hết hạn</option></select></label>
        </div>
      </div>
      <div className="owner-calendar-date-panel">
        <div className="owner-calendar-view-switch" role="group" aria-label="Chế độ xem lịch">{(['month', 'week', 'day'] as const).map((view) => <button type="button" key={view} aria-pressed={mode === view} onClick={() => selectMode(view)}>{view === 'month' ? 'Tháng' : view === 'week' ? 'Tuần' : 'Ngày'}</button>)}</div>
        <div className="owner-calendar-period"><button type="button" aria-label="Khoảng trước" onClick={() => movePeriod(-1)}>‹</button><div className="owner-calendar-period-date"><button type="button" className="owner-calendar-period-trigger" aria-label={`Chọn ngày, hiện tại ${periodLabel}`} onClick={openDatePicker}><strong>{periodLabel}</strong><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6.5 3.5v3M13.5 3.5v3M3 8.5h14M6.5 11.5h2M10.5 11.5h3"/></svg></button><input ref={datePickerRef} className="owner-calendar-date-picker-anchor" type="date" aria-label="Chọn ngày" tabIndex={-1} value={date} onChange={(event) => { if (!event.target.value) return; setDate(event.target.value); router.replace(`/workspace/calendar?view=${mode}&date=${event.target.value}`); }} /></div><button type="button" aria-label="Khoảng sau" onClick={() => movePeriod(1)}>›</button></div>
        <div className="owner-calendar-date-controls"><button type="button" className="button button-secondary" onClick={() => { setDate(businessToday); router.replace(`/workspace/calendar?view=${mode}&date=${businessToday}`); }}>Hôm nay</button></div>
      </div>
    </section>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {message && <p className="notice notice-success" role="status">{message}</p>}
    {loading ? <p className="notice" role="status">Đang tải lịch…</p> : mode === 'month' ? <section className="owner-month-calendar" aria-label={`Lịch tháng ${monthTitle}`}><div className="owner-month-grid owner-month-weekdays">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => <span key={day}>{day}</span>)}</div><div className="owner-month-grid">{monthCells.map((dayNumber, index) => {
      const inMonth = dayNumber > 0 && dayNumber <= monthLength; const day = inMonth ? `${date.slice(0, 7)}-${String(dayNumber).padStart(2, '0')}` : ''; const rows = day ? bookingsByDay[day] ?? [] : []; const uniqueStaff = new Set(rows.map((booking) => booking.staffId)).size;
      return <button key={index} type="button" disabled={!inMonth} className={`owner-month-cell${inMonth ? '' : ' is-outside'}${day === businessToday ? ' is-today' : ''}${day === date ? ' is-selected' : ''}`} onClick={() => { setDate(day); setSelectedDay(day); }}><span className="owner-month-date">{inMonth ? dayNumber : ''}{day === businessToday && <small>Hôm nay</small>}</span>{inMonth && <span className="owner-month-summary">{rows.length} lịch</span>}{inMonth && <span className="owner-month-summary">{uniqueStaff} nhân viên</span>}{inMonth && rows.some((booking) => booking.status === 'PENDING') && <span className="owner-month-pending">Có lịch chờ</span>}</button>;
    })}</div></section> : mode === 'week' ? <div className="calendar-week-scroll" aria-label="Lịch theo tuần, cuộn ngang để xem đủ các ngày" tabIndex={0}>
      <div className="calendar-week-grid">{calendarDays.map((day) => {
        const dayBookings = bookingsByDay[day] ?? [];
        const isToday = day === businessToday;
        return <section key={day} className={`calendar-day-column${isToday ? ' is-today' : ''}`} aria-label={`Lịch ngày ${formatWorkspaceDate(day)}`}>
          <h2 className="calendar-day-heading"><strong>{new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(localDayDate(day))}{isToday ? ' · Hôm nay' : ''}</strong><span>{formatWorkspaceDate(day, { year: false })}</span></h2>
          {dayBookings.length === 0 ? <p className="calendar-day-empty">Không có lịch</p> : <div className="calendar-day-bookings">{dayBookings.map(renderBookingCard)}</div>}
        </section>;
      })}</div>
    </div> : <section className="surface-card" aria-label={`Lịch ngày ${formatWorkspaceDate(range.fromDate)}`}>
      <h2 className="surface-card-title" style={{ marginBottom: '1rem' }}>{formatWorkspaceDate(range.fromDate)}</h2>
      {(bookingsByDay[range.fromDate] ?? []).length === 0 ? <p className="calendar-day-empty">Không có lịch đặt khớp bộ lọc trong ngày này.</p> : <div className="calendar-day-agenda is-six-column">{renderDayCards(range.fromDate)}</div>}
    </section>}
    {selectedDay && <div className="owner-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDay(''); }}><section className="owner-day-modal" role="dialog" aria-modal="true" aria-labelledby="owner-day-modal-title"><header><div><p className="owner-kicker">CHI TIẾT TRONG NGÀY</p><h2 id="owner-day-modal-title">{formatWorkspaceDate(selectedDay)}</h2></div><button type="button" className="button button-secondary" onClick={() => setSelectedDay('')}>Đóng</button></header>{(bookingsByDay[selectedDay] ?? []).length === 0 ? <p className="calendar-day-empty">Không có lịch đặt khớp bộ lọc trong ngày này.</p> : <div className="calendar-day-agenda is-six-column">{renderDayCards(selectedDay)}</div>}</section></div>}
    {selectedBooking && <div className="owner-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedBookingId(''); }}><section className="owner-booking-detail-modal" role="dialog" aria-modal="true" aria-labelledby="owner-booking-detail-title">
      <header className="owner-booking-detail-header"><div><p className="owner-kicker">CHI TIẾT LỊCH HẸN</p><h2 id="owner-booking-detail-title">{selectedBooking.serviceSnapshot.name}</h2></div><button type="button" className="button button-secondary" onClick={() => setSelectedBookingId('')}>Đóng</button></header>
      <div className="owner-booking-detail-status"><span className={`status-pill ${statusTone[selectedBooking.status]}`}>{statusLabel[selectedBooking.status]}</span>{selectedBooking.status === 'CONFIRMED' && clockNow !== null && Date.parse(selectedBooking.startsAt) <= clockNow && clockNow < Date.parse(selectedBooking.endsAt) && <span className="calendar-booking-live">Đang diễn ra</span>}</div>
      <dl className="owner-booking-detail-grid">
        <div><dt>Thời gian</dt><dd>{formatWorkspaceDate(selectedBooking.startsAt, { includeTime: true, timeZone: context?.location.timezone })} – {new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(selectedBooking.endsAt))}</dd></div>
        <div><dt>Khách hàng</dt><dd>{selectedBooking.customerName}</dd></div>
        <div><dt>Số điện thoại</dt><dd>{selectedBooking.customerPhone || 'Chưa cung cấp'}</dd></div>
        <div><dt>Email</dt><dd>{selectedBooking.customerEmail || 'Chưa cung cấp'}</dd></div>
        <div className="owner-booking-detail-wide"><dt>Dịch vụ và nhân viên</dt><dd>{selectedBooking.serviceAssignments?.length ? <ul>{selectedBooking.serviceAssignments.map((segment) => {
          const service = selectedBooking.serviceSnapshot.services?.find((item) => item.id === segment.serviceId);
          return <li key={`${selectedBooking.id}-${segment.segmentIndex}`}><strong>{service?.name ?? selectedBooking.serviceSnapshot.name}</strong><span>{new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(segment.startsAt))}–{new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: context?.location.timezone }).format(new Date(segment.endsAt))} · {staffNames[segment.staffId] || 'Không rõ nhân viên'}</span></li>;
        })}</ul> : <span>{selectedBooking.serviceSnapshot.name} · {selectedBooking.serviceSnapshot.durationMinutes} phút · {staffNames[selectedBooking.staffId] || 'Không rõ nhân viên'}</span>}</dd></div>
        {selectedBooking.customerNote && <div className="owner-booking-detail-wide"><dt>Ghi chú của khách</dt><dd>{selectedBooking.customerNote}</dd></div>}
        {selectedBooking.status === 'PENDING' && selectedBooking.pendingExpiresAt && <div><dt>Hạn xác nhận</dt><dd>{formatWorkspaceDate(selectedBooking.pendingExpiresAt, { includeTime: true, timeZone: context?.location.timezone })}</dd></div>}
        <div><dt>Chế độ xác nhận</dt><dd>{selectedBooking.policySnapshot.confirmationMode === 'MANUAL' ? 'Chủ tiệm xác nhận thủ công' : 'Tự động xác nhận'}</dd></div>
        <div><dt>Điều kiện đổi lịch</dt><dd>{selectedBooking.policySnapshot.rescheduleCutoffMinutes} phút trước giờ hẹn</dd></div>
        <div><dt>Điều kiện hủy</dt><dd>{selectedBooking.policySnapshot.cancellationCutoffMinutes} phút trước giờ hẹn</dd></div>
        <div><dt>Mã lịch</dt><dd className="owner-booking-detail-id">{selectedBooking.id}</dd></div>
        <div><dt>Đặt lúc</dt><dd>{formatWorkspaceDate(selectedBooking.createdAt, { includeTime: true, timeZone: context?.location.timezone })}</dd></div>
      </dl>
    </section></div>}
  </div></main>;
}
