'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { BookingScheduleSuggestionDto, PublicBookingSummary, PublicCreateBookingRequest, PublicServiceDto, PublicStaffDto, PublicTenantPageDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { tenantThemeStyle } from '@/lib/tenant-themes';

const field: React.CSSProperties = { width: '100%', padding: '0.75rem', border: '1px solid var(--line)', borderRadius: '0.6rem', font: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };

function formatServicePrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('vi-VN')} ${currency}`;
  }
}

function guestTimeLabel(value?: string | null) {
  return (value ?? '').replace(/\s*\(GMT[^)]*\)$/i, '');
}

function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function PublicBookingPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [services, setServices] = useState<PublicServiceDto[]>([]);
  const [tenantPage, setTenantPage] = useState<PublicTenantPageDto | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState(todayLocal);
  const staffId = '';
  const [staffByService, setStaffByService] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<BookingScheduleSuggestionDto[]>([]);
  const [visibleSuggestionCount, setVisibleSuggestionCount] = useState(6);
  const [openSuggestionPopover, setOpenSuggestionPopover] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<PublicStaffDto[]>([]);
  const [staffOptionsByService, setStaffOptionsByService] = useState<Record<string, PublicStaffDto[]>>({});
  const [selectedSlot, setSelectedSlot] = useState<BookingScheduleSuggestionDto | null>(null);
  const [businessTimezone, setBusinessTimezone] = useState('');
  const [bookingStep, setBookingStep] = useState(1);
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [booking, setBooking] = useState<PublicBookingSummary | null>(null);
  const [recoveredFromPrevious, setRecoveredFromPrevious] = useState(false);
  const idempotencyKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryContact, setRecoveryContact] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoveryNotFound, setRecoveryNotFound] = useState(false);
  const attemptStorageKey = `zenbook:booking-attempt:v1:${slug}`;
  const selectedServices = services.filter((service) => serviceIds.includes(service.id));
  const selectedService = selectedServices[0];
  const totalDuration = selectedServices.reduce((sum, service) => sum + service.durationMinutes, 0);
  const totalPrice = selectedServices.reduce((sum, service) => sum + service.priceMinor, 0);
  const scheduledIds = selectedSlot?.segments.map((segment) => segment.serviceId) ?? serviceIds;
  const scheduledServices = services.filter((service) => scheduledIds.includes(service.id));
  const visibleSuggestions = suggestions.slice(0, visibleSuggestionCount);
  const scheduledDuration = scheduledServices.reduce((sum, service) => sum + service.durationMinutes, 0);
  const scheduledPrice = scheduledServices.reduce((sum, service) => sum + service.priceMinor, 0);
  const serviceIdsKey = serviceIds.join(',');

  useEffect(() => {
    let active = true;
    Promise.all([api.publicServices(slug), api.publicTenantPage(slug)]).then(([rows, page]) => {
      if (!active) return;
      setServices(rows);
      setTenantPage(page);
      setServiceIds(rows[0] ? [rows[0].id] : []);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Không tải được dịch vụ.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    idempotencyKey.current = null;
    setRecoveryKey(null);
    setRecoveryNotFound(false);
    try {
      const raw = sessionStorage.getItem(attemptStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { key?: unknown; createdAt?: unknown };
      const valid = typeof saved.key === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.key)
        && typeof saved.createdAt === 'number' && saved.createdAt <= Date.now() && Date.now() - saved.createdAt < 24 * 60 * 60_000;
      if (valid) {
        idempotencyKey.current = { fingerprint: '', key: saved.key as string };
        setRecoveryKey(saved.key as string);
        setRecoveryNotFound(false);
      } else sessionStorage.removeItem(attemptStorageKey);
    } catch {
      // Session storage is optional; customer details are never written there.
    }
  }, [attemptStorageKey]);

  useEffect(() => {
    if (!serviceIds.length || !date) { setSuggestions([]); setStaffOptions([]); setAvailabilityLoading(false); return; }
    let active = true;
    setSelectedSlot(null);
    setOpenSuggestionPopover(null);
    setError('');
    setSuggestions([]);
    setVisibleSuggestionCount(6);
    setAvailabilityLoading(true);
    Promise.all([
      api.publicBookingSuggestions(slug, serviceIds, date, staffByService),
      Promise.all(serviceIds.map((id) => api.publicStaff(slug, id))),
    ]).then(([availableSchedules, staffLists]) => {
      if (active) {
        setSuggestions(availableSchedules);
        setStaffOptionsByService(Object.fromEntries(serviceIds.map((id, index) => [id, staffLists[index] ?? []])));
        setStaffOptions(staffLists.flat().filter((person, index, all) => all.findIndex((candidate) => candidate.id === person.id) === index));
      }
    }).catch((cause) => {
      if (active) { setSuggestions([]); setStaffOptions([]); setError(cause instanceof Error ? cause.message : 'Không tải được gợi ý lịch.'); }
    }).finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [slug, serviceIdsKey, date, JSON.stringify(staffByService), availabilityRefresh]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (bookingStep !== 3) return;
    if (!selectedSlot) { setError('Hãy chọn một giờ còn trống.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const dto: PublicCreateBookingRequest = {
        serviceId: selectedSlot.segments[0].serviceId, serviceIds: selectedSlot.segments.map((segment) => segment.serviceId), serviceAssignments: selectedSlot.segments.map(({ serviceId, staffId, startsAt }) => ({ serviceId, staffId, startsAt })), startsAt: selectedSlot.startsAt,
        staffSelection: 'ANY_AVAILABLE', customerName, customerPhone, ...(customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}), ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
      };
      const fingerprint = JSON.stringify(dto);
      if (recoveryKey && !idempotencyKey.current?.fingerprint) throw new Error('Khôi phục kết quả lần đặt trước trước khi gửi lại.');
      if (idempotencyKey.current?.fingerprint && idempotencyKey.current.fingerprint !== fingerprint) {
        throw new Error('Lần đặt trước chưa rõ kết quả. Giữ nguyên nội dung để thử lại hoặc khôi phục bằng số điện thoại/email.');
      }
      if (!idempotencyKey.current) {
        const key = crypto.randomUUID();
        idempotencyKey.current = { fingerprint, key };
        setRecoveryKey(key);
        try { sessionStorage.setItem(attemptStorageKey, JSON.stringify({ key, createdAt: Date.now() })); } catch { /* Recovery remains available until the page closes. */ }
      } else if (!idempotencyKey.current.fingerprint) {
        idempotencyKey.current = { ...idempotencyKey.current, fingerprint };
      }
      const result = await api.createPublicBooking(slug, dto, idempotencyKey.current.key);
      setBooking(result);
      setRecoveredFromPrevious(false);
      setBusinessTimezone(selectedSlot.timezone);
      try { sessionStorage.removeItem(attemptStorageKey); } catch { /* Ignore unavailable storage. */ }
      idempotencyKey.current = null;
      setRecoveryKey(null);
      setMessage('Đặt lịch thành công. Hãy lưu phiếu xác nhận này để đối chiếu với tiệm.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo đặt lịch. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }

  async function recoverBooking() {
    if (!recoveryKey || !recoveryContact.trim()) return;
    setRecovering(true); setError(''); setMessage('');
    try {
      const result = await api.recoverPublicBooking(slug, recoveryKey, recoveryContact.trim());
      if (!result.found) {
        setRecoveryNotFound(true);
        setMessage('Chưa tìm thấy kết quả. Hãy kiểm tra email/số điện thoại; nếu chắc chắn chưa có lịch, bạn có thể chủ động bắt đầu lượt mới.');
        return;
      }
      setBooking(result.booking);
      setRecoveredFromPrevious(true);
      setBusinessTimezone(result.timezone);
      const ids = result.booking.serviceAssignments?.map((segment) => segment.serviceId) ?? [result.booking.serviceId];
      setServiceIds([...new Set(ids)]);
      setMessage('Đã khôi phục phiếu đặt lịch trước đó.');
      try { sessionStorage.removeItem(attemptStorageKey); } catch { /* Ignore unavailable storage. */ }
      idempotencyKey.current = null;
      setRecoveryKey(null);
      setRecoveryNotFound(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tra kết quả lúc này.');
    } finally { setRecovering(false); }
  }

  function startNewBookingAttempt() {
    try { sessionStorage.removeItem(attemptStorageKey); } catch { /* Ignore unavailable storage. */ }
    idempotencyKey.current = null;
    setRecoveryKey(null);
    setRecoveryNotFound(false);
    setRecoveryContact('');
    setRecoveredFromPrevious(false);
    setMessage('Bạn có thể bắt đầu một lượt đặt lịch mới.');
  }

  if (loading) return <main className="app-page"><div className="app-container"><p className="notice" role="status">Đang tải trang đặt lịch…</p></div></main>;

  return <main className="app-page public-booking-page" data-tenant-theme={tenantPage?.themeKey ?? (tenantPage?.themeMode === 'dark' ? 'default' : undefined)} data-theme-mode={tenantPage?.themeMode ?? 'light'} style={tenantThemeStyle(tenantPage?.themeKey, tenantPage?.themeMode)}>
    <div className="app-container public-booking-container">
      <header className="public-tenant-brand" style={{ marginBottom: '1.25rem' }}><span className="public-tenant-mark" aria-hidden="true">{tenantPage?.displayName.slice(0, 1).toLocaleUpperCase('vi-VN') ?? '•'}</span><div className="public-tenant-brand-copy"><p className="eyebrow">ĐẶT LỊCH TRỰC TUYẾN</p><h1 className="page-title">{tenantPage?.displayName ?? 'Đặt lịch dịch vụ'}</h1><p className="page-description">Chọn dịch vụ của tiệm và khung giờ phù hợp với bạn.</p></div></header>
      {!booking && <nav aria-label="Tiến trình đặt lịch" className="booking-progress surface-card">
        {[['1', 'Dịch vụ và giờ'], ['2', 'Thông tin liên hệ'], ['3', 'Xác nhận']].map(([step, label], index) => {
          const stepNumber = index + 1;
          const current = bookingStep === stepNumber;
          const complete = bookingStep > stepNumber;
          return <div key={step} className={`booking-progress-step${current ? ' is-current' : ''}${complete ? ' is-complete' : ''}`} aria-current={current ? 'step' : undefined}>
            <span className="booking-progress-number">{complete ? '✓' : step}</span><span>{label}</span>
          </div>;
        })}
      </nav>}
      {error && <p role="alert" className="notice-error" style={{ padding: '0.85rem', borderRadius: '0.6rem' }}>{error}</p>}
      {message && <p role="status" style={{ padding: '0.85rem', borderRadius: '0.6rem', color: 'var(--accent)', background: 'var(--accent-soft)' }}>{message}</p>}
      {!booking && recoveryKey && <section className="notice public-booking-recovery" aria-labelledby="booking-recovery-title">
        <h2 id="booking-recovery-title">Kiểm tra lần đặt trước</h2>
        <p>Nhập email nếu bạn đã điền email khi đặt; nếu không, nhập số điện thoại. Thông tin chỉ được gửi để tra cứu và không lưu trong trình duyệt.</p>
        <div className="action-row">
          <input aria-label="Số điện thoại hoặc email đã dùng khi đặt" autoComplete="off" value={recoveryContact} onChange={(event) => setRecoveryContact(event.target.value)} placeholder="Số điện thoại hoặc email" style={field} />
          <button type="button" className="button button-primary" disabled={recovering || !recoveryContact.trim()} onClick={recoverBooking}>{recovering ? 'Đang tra cứu…' : 'Khôi phục phiếu'}</button>
        </div>
        {recoveryNotFound && <button type="button" className="button button-secondary" onClick={startNewBookingAttempt}>Không có lịch trước đó · Bắt đầu lượt mới</button>}
      </section>}
      {booking ? <section className="welcome-card public-booking-receipt" aria-labelledby="booking-receipt-title" style={{ width: '100%', padding: 'clamp(1.25rem, 4vw, 2rem)' }}>
        <header className="booking-receipt-header"><div><p className="eyebrow">XÁC NHẬN ĐẶT LỊCH</p><h2 id="booking-receipt-title">{tenantPage?.displayName ?? 'Lịch hẹn của bạn'}</h2></div><span className={`status-pill ${booking.status === 'PENDING' ? 'status-pill-warning' : 'status-pill-success'}`}>{booking.status === 'PENDING' ? 'Chờ tiệm xác nhận' : booking.status === 'CONFIRMED' ? 'Đã xác nhận' : booking.status}</span></header>
        <p className="booking-receipt-code">Mã đặt lịch <code>{booking.id}</code></p>
        <dl className="booking-receipt-details">
          <div><dt>Dịch vụ</dt><dd>{booking.serviceName} · {Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000)} phút</dd></div>
          <div><dt>Giá dịch vụ</dt><dd>{selectedService ? formatServicePrice(totalPrice, selectedService.currency) : '—'}</dd></div>
          <div><dt>Thời gian</dt><dd>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'full', timeStyle: 'short', timeZone: businessTimezone || 'UTC' }).format(new Date(booking.startsAt))} – {new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: businessTimezone || 'UTC' }).format(new Date(booking.endsAt))}</dd></div>
          <div><dt>Phân công</dt><dd>{booking.serviceAssignments?.map((segment) => `${services.find((service) => service.id === segment.serviceId)?.name ?? 'Dịch vụ'}: ${staffOptionsByService[segment.serviceId]?.find((person) => person.id === segment.staffId)?.name ?? 'Đã phân công'}`).join(' · ') ?? 'Đã được phân công'}</dd></div>
          {(customerName || customerPhone || customerEmail.trim()) && <div><dt>Khách hàng</dt><dd>{[customerName, customerPhone, customerEmail.trim()].filter(Boolean).join(" · ")}</dd></div>}
          {booking.customerNote && <div><dt>Ghi chú</dt><dd>{booking.customerNote}</dd></div>}
        </dl>
        <p className="booking-receipt-note">{recoveredFromPrevious ? 'Phiếu được khôi phục. Thông tin liên hệ không lưu trong trình duyệt; hãy đối chiếu mã đặt lịch này với tiệm.' : <>Hãy chụp màn hình phiếu này để lưu thông tin và đối chiếu với tiệm. {customerEmail.trim() ? 'Liên kết quản lý lịch được gửi đến email bạn cung cấp để xem, đổi hoặc hủy lịch. Email được gửi tự động; phiếu này chưa xác nhận email đã đến hộp thư.' : 'Bạn chưa cung cấp email nên không có liên kết tự quản lý lịch. Nếu cần đổi hoặc hủy, vui lòng liên hệ trực tiếp với tiệm.'}</>}</p>
      </section> : <form className="public-booking-form" onSubmit={submit} style={{ display: 'grid', gap: '1rem', padding: 'clamp(1.1rem, 4vw, 2rem)', borderRadius: '1rem', background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {services.length === 0 ? <p role="status">Chưa có dịch vụ nào được mở đặt lịch.</p> : <>
          {bookingStep === 1 && <section className="stack-lg" aria-labelledby="booking-select-title">
            <div><h2 id="booking-select-title">Chọn dịch vụ và thời gian</h2></div>
            <fieldset className="service-choices"><legend>Chọn tối đa 3 dịch vụ <span className="helper-text">(hệ thống tự xếp lịch cho cả chuỗi)</span></legend><div className="service-choice-list">{services.map((service) => <div key={service.id} className={`service-choice-card${serviceIds.includes(service.id) ? ' is-selected' : ''}`}>
              <label className="service-choice">
                <input type="checkbox" name="service" value={service.id} checked={serviceIds.includes(service.id)} disabled={!serviceIds.includes(service.id) && serviceIds.length >= 3} onChange={() => { setServiceIds((current) => current.includes(service.id) ? current.filter((id) => id !== service.id) : [...current, service.id]); setStaffByService((current) => { const next = { ...current }; delete next[service.id]; return next; }); setSelectedSlot(null); }} />
                <span className="service-choice-copy"><span className="service-choice-heading"><strong>{service.name} <span className="service-choice-duration">({service.durationMinutes} phút)</span></strong><span className="service-choice-price">{formatServicePrice(service.priceMinor, service.currency)}</span></span></span>
              </label>
              {service.description && <details className="service-choice-description"><summary>Mô tả</summary><p>{service.description}</p></details>}
            </div>)}</div>{selectedServices.length > 1 && <p className="notice public-selection-total">{selectedServices.length} dịch vụ · {totalDuration} phút · {formatServicePrice(totalPrice, selectedService.currency)}</p>}</fieldset>
            <label className="field-group">Ngày hẹn<input type="date" min={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} required style={field} /></label>
            {selectedServices.map((service) => <label key={service.id} className="field-group">Nhân viên cho {service.name}<select value={staffByService[service.id] ?? ''} onChange={(e) => { setStaffByService((current) => ({ ...current, [service.id]: e.target.value })); setSelectedSlot(null); }} style={field}><option value="">Bất kỳ nhân viên phù hợp</option>{(staffOptionsByService[service.id] ?? []).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}
            <fieldset className="booking-slots"><legend>Giờ còn trống</legend>
              {availabilityLoading ? <p className="notice" role="status" aria-live="polite">Đang tìm phương án cho dịch vụ đã chọn…</p> : error ? <div className="stack-sm"><p className="notice notice-error" role="status">Không tải được gợi ý lịch. Kiểm tra kết nối rồi thử lại.</p><button type="button" className="button button-secondary" onClick={() => setAvailabilityRefresh((value) => value + 1)}>Thử tải lại</button></div> : suggestions.length === 0 ? <p className="notice" role="status">Không tìm được lịch phù hợp. Hãy đổi ngày hoặc nhân viên.</p> : <>
                                <div className="public-schedule-suggestions">{visibleSuggestions.map((suggestion, index) => {
                  const hasOmission = suggestion.omittedServiceIds.length > 0;
                  const suggestionKey = `${suggestion.startsAt}:${suggestion.omittedServiceIds.slice().sort().join(',')}`;
                  const includedNames = suggestion.segments.map((segment) => services.find((service) => service.id === segment.serviceId)?.name ?? 'Dịch vụ');
                  const omittedNames = suggestion.omittedServiceIds.map((id) => services.find((service) => service.id === id)?.name ?? 'dịch vụ');
                  return <div key={suggestionKey} className={`public-schedule-option-wrap${index % 5 >= 3 ? ' is-right' : ''}`}>
                    <button type="button" aria-pressed={selectedSlot === suggestion} aria-expanded={hasOmission && openSuggestionPopover === suggestionKey} aria-controls={hasOmission ? `schedule-hint-${index}` : undefined} onClick={() => { setSelectedSlot(suggestion); setOpenSuggestionPopover(hasOmission ? (current) => current === suggestionKey ? null : suggestionKey : null); }} className={`public-schedule-option${selectedSlot === suggestion ? ' is-selected' : ''}`}>
                      <strong>{guestTimeLabel(suggestion.localStart)}</strong>{hasOmission && <span className="public-schedule-hint-mark" aria-hidden="true">i</span>}
                    </button>
                    {hasOmission && openSuggestionPopover === suggestionKey && <div id={`schedule-hint-${index}`} role="status" className="public-schedule-popover">
                      <button type="button" className="public-schedule-popover-close" aria-label="Đóng gợi ý" onClick={() => setOpenSuggestionPopover(null)}>×</button>
                      <strong>Gợi ý lịch</strong>
                      <p>Bỏ {omittedNames.join(', ')} để đặt {includedNames.join(', ')}.</p>
                    </div>}
                  </div>;
                })}</div>{suggestions.length > visibleSuggestions.length && <button type="button" className="public-schedule-more" onClick={() => setVisibleSuggestionCount((count) => Math.min(count + 6, suggestions.length))}>Xem thêm giờ ({suggestions.length - visibleSuggestions.length})</button>}
              </>}
            </fieldset>
            <div className="action-row"><button type="button" className="button button-primary" disabled={!selectedSlot || availabilityLoading} onClick={() => setBookingStep(2)}>Tiếp tục</button></div>
          </section>}

          {bookingStep === 2 && <section className="stack-lg" aria-labelledby="booking-contact-title">
            <div><h2 id="booking-contact-title">Thông tin liên hệ</h2><p className="page-description">Tên và số điện thoại giúp tiệm xác nhận lịch. Email không bắt buộc; nếu cung cấp, bạn sẽ nhận liên kết quản lý lịch.</p></div>
            <div className="notice"><strong>{scheduledServices.map((service) => service.name).join(' + ')}</strong> · {date} · {guestTimeLabel(selectedSlot?.localStart)}</div>
            <label className="field-group">Họ tên<input autoComplete="name" required maxLength={255} value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={field} /></label>
            <label className="field-group">Số điện thoại<input type="tel" autoComplete="tel" inputMode="tel" required minLength={9} maxLength={20} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} style={field} /></label>
            <label className="field-group">Email <span>(không bắt buộc)</span><input type="email" autoComplete="email" maxLength={255} value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} style={field} /><small>Nhận liên kết bảo mật để xem, đổi hoặc hủy lịch đặt.</small></label>
            <label className="field-group">Ghi chú cho tiệm <span>(không bắt buộc)</span><textarea maxLength={1000} rows={3} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder="Ví dụ: yêu cầu thêm hoặc lưu ý khi phục vụ" style={{ ...field, resize: 'vertical', minHeight: '5rem' }} /><small>{customerNote.length}/1000 ký tự</small></label>
            <div className="action-row"><button type="button" className="button button-secondary" onClick={() => setBookingStep(1)}>Quay lại chọn giờ</button><button type="button" className="button button-primary" onClick={(e) => { if (e.currentTarget.form?.reportValidity()) setBookingStep(3); }}>Xem lại</button></div>
          </section>}

          {bookingStep === 3 && <section className="stack-lg" aria-labelledby="booking-review-title">
            <div><h2 id="booking-review-title">Kiểm tra thông tin</h2><p className="page-description">Hãy xác nhận dịch vụ, giờ hẹn và thông tin liên hệ trước khi hoàn tất.</p></div>
            <dl className="booking-summary">
              <div><dt>Dịch vụ</dt><dd>{scheduledServices.map((service) => service.name).join(' + ')} · {scheduledDuration} phút</dd></div>
              <div><dt>Giá dịch vụ</dt><dd>{scheduledServices[0] ? formatServicePrice(scheduledPrice, scheduledServices[0].currency) : '-'}</dd></div>
              <div><dt>Ngày và giờ</dt><dd>{date} · {guestTimeLabel(selectedSlot?.localStart)}</dd></div>
              <div><dt>Phân công</dt><dd>{selectedSlot?.segments.map((segment) => `${services.find((service) => service.id === segment.serviceId)?.name}: ${staffOptionsByService[segment.serviceId]?.find((person) => person.id === segment.staffId)?.name ?? 'Nhân viên'}`).join(' · ')}</dd></div>
              <div><dt>Khách hàng</dt><dd>{customerName} · {customerPhone}{customerEmail.trim() ? ` · ${customerEmail.trim()}` : ''}</dd></div>
              {customerNote.trim() && <div><dt>Ghi chú</dt><dd>{customerNote.trim()}</dd></div>}
            </dl>
            <div className="action-row"><button type="button" className="button button-secondary" onClick={() => setBookingStep(2)}>Sửa thông tin liên hệ</button><button type="button" className="button button-secondary" onClick={() => setBookingStep(1)}>Đổi dịch vụ hoặc giờ</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Đang tạo đặt lịch…' : 'Xác nhận đặt lịch'}</button></div>
          </section>}
        </>}
      </form>}
    </div>
  </main>;
}
