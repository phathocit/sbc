'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Anchor, Burger, Button, Container, Drawer, Group, Paper, Select, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { api } from '@/lib/api';
import type { PlanDto } from '@sbc/contracts';

const services = [
  { icon: 'vet', name: 'Phòng khám thú y', detail: 'Một số dịch vụ phổ biến tại phòng khám.', bullets: ['Khám và tư vấn sức khỏe', 'Tiêm phòng vaccine', 'Xét nghiệm và siêu âm'] },
  { icon: 'hair', name: 'Salon & barber', detail: 'Các dịch vụ chăm sóc và tạo kiểu tóc.', bullets: ['Cắt tóc nam, nữ', 'Gội đầu và tạo kiểu', 'Uốn, duỗi hoặc nhuộm'] },
  { icon: 'nail', name: 'Nail & làm đẹp', detail: 'Dịch vụ chăm sóc móng theo lịch hẹn.', bullets: ['Chăm sóc móng tay, móng chân', 'Sơn gel', 'Đắp móng và vẽ nail'] },
  { icon: 'massage', name: 'Massage dưỡng sinh', detail: 'Chăm sóc và thư giãn cơ thể theo lịch hẹn.', bullets: ['Gội đầu dưỡng sinh', 'Massage cổ vai gáy', 'Chăm sóc thư giãn toàn thân'] },
  { icon: 'makeup', name: 'Makeup & chăm sóc', detail: 'Lịch trang điểm cho các dịp và nhu cầu khác nhau.', bullets: ['Makeup dự tiệc', 'Makeup cô dâu', 'Trang điểm cá nhân'] },
  { icon: 'general', name: 'Dịch vụ khác', detail: 'Nhiều dịch vụ có thể nhận khách theo khung giờ.', bullets: ['Massage thư giãn', 'Chăm sóc da mặt', 'Tư vấn hoặc huấn luyện cá nhân'] },
];

function ServiceIcon({ type }: { type: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {type === 'vet' && <><path d="m5 9 1-4 5 3h2l5-3 1 4v5a7 7 0 0 1-14 0V9Z"/><path d="M9 13h.01M15 13h.01m-5 3 2 1.5 2-1.5"/><path d="M11 16v1m2-1v1"/></>}
    {type === 'hair' && <><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 8 12 12M8 16 20 4M13 12l7 8"/></>}
    {type === 'nail' && <><path d="M7 21V10a5 5 0 0 1 10 0v11H7Z"/><path d="M9 10a3 3 0 0 1 6 0v4H9v-4Z" fill="currentColor" fillOpacity=".24"/></>}
    {type === 'repair' && <><path d="M14 6a5 5 0 0 0 6 6l-9.5 9.5a2.1 2.1 0 0 1-3-3L17 9a5 5 0 0 0-6-6l3 3-3 3-3-3a5 5 0 0 0 6 6"/><path d="m5 19 2 2"/></>}
    {type === 'massage' && <><path d="M4 14c2-2 3-4 3-7 2 1 3 3 3 5m10 2c-2-2-3-4-3-7-2 1-3 3-3 5"/><path d="m3.5 14.5 5.2 5.2a4.2 4.2 0 0 0 5.9 0l5.9-5.9"/><path d="M12 3v2m-5-1 1 2m9-2-1 2"/></>}
    {type === 'makeup' && <><path d="M8 21h10v-4H8zM10 17V9h6v8M10 9l2-6h3l1 6"/><path d="M12 3h3M11 12h4"/></>}
    {type === 'general' && <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 14h3m2 0h3m-8 3h3"/></>}
  </svg>;
}

function CalendarPreview() {
  const rows = [
    ['09:00', 'Khách hàng mới', 'Tư vấn dịch vụ', 'gold'],
    ['10:30', 'Lịch hẹn tiếp theo', 'Đã xác nhận', 'mint'],
    ['13:00', 'Khách hàng', 'Dịch vụ tại cửa tiệm', 'slate'],
    ['15:30', 'Lịch hẹn chiều', 'Chờ xác nhận', 'gold'],
  ];
  return (
    <div className="zen-calendar" aria-label="Minh họa lịch hẹn">
      <div className="zen-calendar-top"><div><span className="zen-kicker">WORKSPACE</span><strong>Lịch hẹn</strong></div><span className="zen-calendar-month">Tháng 11 <span>⌄</span></span></div>
      <div className="zen-calendar-tabs"><span className="active">Ngày</span><span>Tuần</span><span>Tháng</span><span className="zen-date">Thứ Tư · 5/11</span></div>
      <div className="zen-timeline">{rows.map(([time, name, detail, tone]) => <div className="zen-event" key={time}><time>{time}</time><div className={`zen-event-card ${tone}`}><b>{name}</b><small>{detail}</small></div></div>)}</div>
      <div className="zen-calendar-foot"><span className="zen-live-dot" />Lịch hẹn được sắp xếp trong một màn hình</div>
    </div>
  );
}

function BookingPreview() {
  return <div className="zen-phone" aria-label="Minh họa trang đặt lịch công khai"><div className="zen-phone-camera" /><div className="zen-phone-content"><span className="zen-kicker">ĐẶT LỊCH TRỰC TUYẾN</span><h3>Tiệm của bạn</h3><p>Chọn dịch vụ phù hợp</p><div className="zen-phone-service"><span className="zen-service-icon">✦</span><div><b>Dịch vụ chăm sóc</b><small>45 phút</small></div><strong>›</strong></div><div className="zen-phone-service"><span className="zen-service-icon">✧</span><div><b>Dịch vụ chuyên sâu</b><small>60 phút</small></div><strong>›</strong></div><p className="zen-phone-label">CHỌN NGÀY HẸN</p><div className="zen-days"><span>T5<b>06</b></span><span className="chosen">T6<b>07</b></span><span>T7<b>08</b></span><span>CN<b>09</b></span></div><div className="zen-phone-cta">Tiếp tục <span>→</span></div></div></div>;
}

function PricingSkeleton() {
  return <div className="zen-pricing-grid zen-pricing-grid-loading" role="status" aria-label="Đang tải các gói dịch vụ" aria-busy="true">{[0, 1, 2].map((item) => <div className="zen-plan-skeleton" key={item} aria-hidden="true"><span className="zen-skeleton-block zen-skeleton-badge"/><span className="zen-skeleton-block zen-skeleton-title"/><span className="zen-skeleton-block zen-skeleton-copy"/><span className="zen-skeleton-block zen-skeleton-price"/><div className="zen-skeleton-features"><span className="zen-skeleton-block"/><span className="zen-skeleton-block"/><span className="zen-skeleton-block"/><span className="zen-skeleton-block"/></div><span className="zen-skeleton-block zen-skeleton-button"/></div>)}</div>;
}

function PlanSelectorSkeleton() {
  return <div className="zen-plan-mini-grid zen-plan-mini-grid-loading" role="status" aria-label="Đang tải lựa chọn gói" aria-busy="true">{[0, 1, 2].map((item) => <div className="zen-plan-mini-skeleton" key={item} aria-hidden="true"><span className="zen-skeleton-block zen-skeleton-radio"/><span className="zen-skeleton-block zen-skeleton-title"/><span className="zen-skeleton-block zen-skeleton-price"/><span className="zen-skeleton-block zen-skeleton-copy"/></div>)}</div>;
}

function AnimatedHeadlineText({ text, delay = 0, exiting = false, exitOffset = 0 }: { text: string; delay?: number; exiting?: boolean; exitOffset?: number }) {
  return <>{Array.from(text).map((character, index) => <Fragment key={index}>{character === ' ' ? ' ' : <span className="zen-hero-letter" style={{ animationDelay: (exiting ? exitOffset + (text.length - index - 1) * 14 : delay + index * 24) + 'ms' }}>{character}</span>}</Fragment>)}</>;
}

function AnimatedHeroHeadline() {
  const [cycle, setCycle] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let exitTimer: number;
    let restartTimer: number;
    const scheduleCycle = () => {
      exitTimer = window.setTimeout(() => setIsExiting(true), 4400);
      restartTimer = window.setTimeout(() => {
        setCycle((value) => value + 1);
        setIsExiting(false);
        scheduleCycle();
      }, 6400);
    };
    scheduleCycle();
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(restartTimer);
    };
  }, []);

  const lineClass = 'zen-hero-letter-line' + (isExiting ? ' is-exiting' : '');
  return <Title order={1} className="zen-hero-title" aria-label="Trang đặt lịch riêng cho tiệm. Rõ ràng cho khách, nhẹ nhàng cho bạn."><span key={cycle} className={lineClass} aria-hidden="true"><AnimatedHeadlineText text="Trang đặt lịch riêng cho tiệm." exiting={isExiting} exitOffset={518}/></span><br/><span key={'accent-' + cycle} className={'zen-hero-title-accent ' + lineClass} aria-hidden="true"><AnimatedHeadlineText text="Rõ ràng cho khách, nhẹ nhàng cho bạn." delay={650} exiting={isExiting}/></span></Title>;
}

export default function HomePage() {
  const [showPlatformConsole, setShowPlatformConsole] = useState(false);
  const [consultationOpen, setConsultationOpen] = useState(false);
  const [consultationClosing, setConsultationClosing] = useState(false);
  const [consultationToast, setConsultationToast] = useState(false);
  const [consultationSubmitting, setConsultationSubmitting] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [serviceType, setServiceType] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [publicPlans, setPublicPlans] = useState<PlanDto[]>([]);
  const [publicPlansLoading, setPublicPlansLoading] = useState(true);
  const [publicPlansError, setPublicPlansError] = useState(false);
  const [planError, setPlanError] = useState(false);
  const consultationPanelRef = useRef<HTMLElement | null>(null);
  const consultationFormRef = useRef<HTMLFormElement | null>(null);
  const consultationReturnFocusRef = useRef<HTMLElement | null>(null);
  const consultationCloseTimerRef = useRef<number | null>(null);
  const consultationToastTimerRef = useRef<number | null>(null);
  const consultationNudgeAnimationRef = useRef<Animation | null>(null);
  const loadPublicPlans = useCallback(async () => {
    setPublicPlansLoading(true);
    setPublicPlansError(false);
    try {
      setPublicPlans(await api.listPublicPlans());
    } catch {
      setPublicPlans([]);
      setPublicPlansError(true);
    } finally {
      setPublicPlansLoading(false);
    }
  }, []);
  useEffect(() => { void loadPublicPlans(); }, [loadPublicPlans]);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const landing = document.querySelector<HTMLElement>('.zen-landing');
    if (!landing) return;
    const revealElements = Array.from(landing.querySelectorAll<HTMLElement>('.zen-reveal'));
    if (!revealElements.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    for (const element of revealElements) observer.observe(element);
    landing.classList.add('has-scroll-reveal');
    return () => { observer.disconnect(); };
  }, [publicPlans.length]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [headerFixed, setHeaderFixed] = useState(false);
  const headerFixedRef = useRef(false);
  const backToTopProgressRef = useRef<SVGCircleElement | null>(null);
  const nudgeConsultation = useCallback(() => {
    const panel = consultationPanelRef.current;
    if (!panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    consultationNudgeAnimationRef.current?.cancel();
    consultationNudgeAnimationRef.current = panel.animate(
      [
        { top: '0px', boxShadow: '0 24px 60px rgba(0,0,0,.46), 0 12px 32px rgba(226,194,107,.07)' },
        { top: '6px', boxShadow: '0 30px 66px rgba(0,0,0,.5), 0 12px 38px rgba(226,194,107,.16)', offset: 0.38 },
        { top: '-3px', boxShadow: '0 22px 56px rgba(0,0,0,.46), 0 12px 30px rgba(226,194,107,.1)', offset: 0.72 },
        { top: '0px', boxShadow: '0 24px 60px rgba(0,0,0,.46), 0 12px 32px rgba(226,194,107,.07)' },
      ],
      { duration: 560, easing: 'cubic-bezier(.2,.8,.3,1)' },
    );
  }, []);
  const openConsultation = useCallback(() => {
    if (consultationOpen && !consultationClosing) {
      nudgeConsultation();
      return;
    }
    if (consultationCloseTimerRef.current !== null) window.clearTimeout(consultationCloseTimerRef.current);
    consultationCloseTimerRef.current = null;
    if (consultationToastTimerRef.current !== null) window.clearTimeout(consultationToastTimerRef.current);
    consultationToastTimerRef.current = null;
    setConsultationToast(false);
    if (document.activeElement instanceof HTMLElement) consultationReturnFocusRef.current = document.activeElement;
    setConsultationClosing(false);
    setConsultationError(null);
    setPlanError(false);
    setConsultationOpen(true);
  }, [consultationOpen, consultationClosing, nudgeConsultation]);
  const closeConsultation = useCallback(() => {
    if (!consultationOpen || consultationClosing) return;
    setConsultationClosing(true);
    consultationCloseTimerRef.current = window.setTimeout(() => {
      setConsultationOpen(false);
      setConsultationClosing(false);
      consultationCloseTimerRef.current = null;
      consultationReturnFocusRef.current?.focus();
    }, 420);
  }, [consultationOpen, consultationClosing]);
  const submitConsultation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!selectedPlan || !serviceType) { setPlanError(true); return; }
    const data = new FormData(event.currentTarget);
    const customServiceType = String(data.get('customServiceType') ?? '').trim();
    if (serviceType === 'Khác' && !customServiceType) { setConsultationError('Vui lòng nhập loại hình dịch vụ của tiệm.'); return; }
    setConsultationSubmitting(true);
    setConsultationError(null);
    try {
      await api.submitPublicTenantApplication({
        applicantName: String(data.get('applicantName') ?? ''),
        applicantEmail: String(data.get('applicantEmail') ?? ''),
        contactPhone: String(data.get('contactPhone') ?? ''),
        name: String(data.get('tenantName') ?? ''),
        serviceType: serviceType === 'Khác' ? customServiceType : serviceType,
        requestedPlan: selectedPlan,
      });
      form.reset();
      setServiceType(null);
      setSelectedPlan(null);
      closeConsultation();
      if (consultationToastTimerRef.current !== null) window.clearTimeout(consultationToastTimerRef.current);
      consultationToastTimerRef.current = window.setTimeout(() => {
        setConsultationToast(true);
        consultationToastTimerRef.current = window.setTimeout(() => {
          setConsultationToast(false);
          consultationToastTimerRef.current = null;
        }, 5000);
      }, 450);
    } catch (error) {
      setConsultationError(error instanceof Error ? error.message : 'Không gửi được hồ sơ. Vui lòng thử lại.');
    } finally { setConsultationSubmitting(false); }
  };
  useEffect(() => {
    if (!consultationOpen || consultationClosing) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.zen-consult-dropdown, .zen-consult-open')) return;
      if (!consultationPanelRef.current?.contains(event.target as Node)) {
        const hasEnteredData = Array.from(consultationFormRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('.zen-consult-field-input, .zen-consult-select-input') ?? []).some((field) => field.value.trim().length > 0);
        if (hasEnteredData) nudgeConsultation();
        else closeConsultation();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeConsultation(); return; }
      if (event.key !== 'Tab' || !consultationPanelRef.current) return;
      const focusable = Array.from(consultationPanelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !consultationPanelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !consultationPanelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    consultationPanelRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [consultationOpen, consultationClosing, closeConsultation, nudgeConsultation]);
  useEffect(() => () => {
    if (consultationCloseTimerRef.current !== null) window.clearTimeout(consultationCloseTimerRef.current);
    if (consultationToastTimerRef.current !== null) window.clearTimeout(consultationToastTimerRef.current);
    consultationNudgeAnimationRef.current?.cancel();
  }, []);
  useEffect(() => {
    const updateScroll = () => {
      const headerHeight = document.querySelector('.zen-header')?.getBoundingClientRect().height ?? 88;
      const scrollY = window.scrollY;
      const showBackTop = scrollY > 520;
      setShowBackToTop((current) => current === showBackTop ? current : showBackTop);

      if (scrollY >= headerHeight) {
        if (!headerFixedRef.current) {
          headerFixedRef.current = true;
          setHeaderFixed(true);
        }
      } else if (scrollY <= 0 && headerFixedRef.current) {
        headerFixedRef.current = false;
        setHeaderFixed(false);
      }
    };
    updateScroll();
    window.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('resize', updateScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateScroll);
      window.removeEventListener('resize', updateScroll);
    };
  }, []);
  useEffect(() => {
    if (!showBackToTop) return;
    const updateProgress = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
      const circumference = 2 * Math.PI * 17;
      if (backToTopProgressRef.current) {
        backToTopProgressRef.current.style.strokeDashoffset = String(circumference * (1 - progress));
      }
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('resize', updateProgress);
    };
  }, [showBackToTop]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const access = await api.getAuthAccess();
        if (!access.platformAdmin) return;
        const bootstrap = await api.platformBootstrapStatus();
        if (bootstrap.available) { if (active) setShowPlatformConsole(true); return; }
        await api.getPlatformSettings();
        if (active) setShowPlatformConsole(true);
      } catch { /* API authorization remains the source of truth. */ }
    })();
    return () => { active = false; };
  }, []);

  return (
    <main id="top" className="zen-landing">
      <Container size="xl" className="zen-container">
        {headerFixed && <div className="zen-header-spacer" aria-hidden="true" />}
        <header className={`zen-header${headerFixed ? ' is-scrolled' : ''}`}>
          <div className="zen-header-inner">
          <Anchor component={Link} href="/" className="zen-brand"><span className="zen-brand-mark">Z</span><span className="zen-brand-copy">Zen<span>Book</span><small>BOOKING, MADE CLEAR</small></span></Anchor>
          <nav className="zen-nav" aria-label="Điều hướng chính"><a href="#audience">Ngành dịch vụ</a><a href="#benefits">Tính năng</a><a href="#how-it-works">Cách hoạt động</a><a href="#pricing">Bảng giá</a><a href="#faq">Câu hỏi thường gặp</a></nav>
          <Group gap="xs"><Button className="zen-button zen-button-small zen-consult-open" aria-expanded={consultationOpen} aria-controls={consultationOpen ? 'zen-consult-panel' : undefined} onClick={openConsultation}>Bắt đầu ngay</Button><Burger className="zen-mobile-burger" opened={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)} aria-label="Mở menu" size="sm" color="#286F95" /></Group>
          </div>
        </header>
        {consultationOpen && <div className={`zen-consult-panel-shell${consultationClosing ? ' is-closing' : ''}`}>
          <section id="zen-consult-panel" ref={consultationPanelRef} className="zen-consult-panel" role="dialog" aria-labelledby="zen-consult-title" aria-modal="true">
            <div className="zen-consult-panel-head"><div><span className="zen-consult-kicker">ZENBOOK · TƯ VẤN CHO TIỆM</span><h2 id="zen-consult-title">Cùng tìm hiểu ZenBook</h2><p>Để lại thông tin để chúng tôi hiểu cách tiệm đang nhận lịch và nhu cầu của bạn.</p></div><button type="button" className="zen-consult-panel-close" onClick={closeConsultation} aria-label="Đóng form tư vấn">×</button></div>
            <form ref={consultationFormRef} className="zen-consult-form" onSubmit={submitConsultation}>
              <section className="zen-consult-group" aria-labelledby="zen-consult-contact-title"><div className="zen-consult-group-title"><span>01</span><div><strong id="zen-consult-contact-title">Thông tin tiệm</strong><small>Thông tin chủ tiệm và cơ sở đăng ký</small></div></div>
                <div className="zen-consult-fields"><TextInput styles={{ input: { color: '#F5F7FA', backgroundColor: '#151922', borderColor: '#464C58' } }} classNames={{ input: 'zen-consult-field-input' }} label="Tên chủ tiệm" placeholder="Ví dụ: Nguyễn Minh Anh" name="applicantName" autoComplete="name" maxLength={100} required /><TextInput styles={{ input: { color: '#F5F7FA', backgroundColor: '#151922', borderColor: '#464C58' } }} classNames={{ input: 'zen-consult-field-input' }} label="Tên tiệm" placeholder="Tên tiệm của bạn" name="tenantName" autoComplete="organization" maxLength={120} required /><div className="zen-consult-row"><TextInput styles={{ input: { color: '#F5F7FA', backgroundColor: '#151922', borderColor: '#464C58' } }} classNames={{ input: 'zen-consult-field-input' }} label="Số điện thoại" placeholder="09xx xxx xxx" type="tel" inputMode="tel" name="contactPhone" autoComplete="tel" maxLength={20} required /><TextInput styles={{ input: { color: '#F5F7FA', backgroundColor: '#151922', borderColor: '#464C58' } }} classNames={{ input: 'zen-consult-field-input' }} label="Email" placeholder="ban@example.com" type="email" inputMode="email" name="applicantEmail" autoComplete="email" maxLength={254} required /></div></div>
              </section>
              <section className="zen-consult-group" aria-labelledby="zen-consult-needs-title"><div className="zen-consult-group-title"><span>02</span><div><strong id="zen-consult-needs-title">Loại hình dịch vụ</strong><small>Chọn ngành gần nhất với tiệm của bạn</small></div></div>
                <div className="zen-consult-fields zen-consult-needs"><Select name="serviceType" value={serviceType} onChange={setServiceType} styles={{ input: { color: '#F5F7FA', backgroundColor: '#151922', borderColor: '#464C58' } }} classNames={{ input: 'zen-consult-select-input', dropdown: 'zen-consult-dropdown', option: 'zen-consult-option' }} aria-label="Loại hình dịch vụ" placeholder="Chọn loại hình dịch vụ" data={['Phòng khám thú y', 'Salon / barber', 'Nail / làm đẹp', 'Massage dưỡng sinh', 'Makeup / chăm sóc', 'Khác']} required searchable clearable />{serviceType === 'Khác' && <TextInput name="customServiceType" styles={{ input: { color: '#F5F7FA', backgroundColor: '#151922', borderColor: '#464C58' } }} classNames={{ input: 'zen-consult-field-input' }} aria-label="Nhập loại hình dịch vụ khác" placeholder="Nhập loại hình dịch vụ của tiệm" maxLength={100} required />}</div>
              </section>
              <section className="zen-consult-group" aria-labelledby="zen-consult-plan-title"><div className="zen-consult-group-title"><span>03</span><div><strong id="zen-consult-plan-title">Chọn gói dịch vụ</strong><small>Chọn gói phù hợp; có thể xác nhận lại sau khi hồ sơ được duyệt</small></div></div>
                {publicPlansLoading ? <PlanSelectorSkeleton /> : publicPlansError ? <div className="zen-plan-load-error" role="alert"><span>Không tải được danh sách gói.</span><button type="button" className="zen-plan-retry" onClick={() => void loadPublicPlans()}>Thử lại</button></div> : publicPlans.length === 0 ? <p className="zen-plan-empty" role="status">Hiện chưa có gói dịch vụ để đăng ký.</p> : <div className="zen-plan-mini-grid" role="group" aria-label="Chọn một gói dịch vụ">{publicPlans.map((plan) => <button key={plan.id} type="button" className={`zen-plan-mini${selectedPlan === plan.code ? ' is-selected' : ''}`} aria-pressed={selectedPlan === plan.code} onClick={() => { setSelectedPlan(plan.code); setPlanError(false); }}><span>{plan.displayName}</span><strong>{plan.priceVnd.toLocaleString('vi-VN')}đ<small>/tháng</small></strong><small>{plan.activeStaffLimit} nhân viên · {plan.monthlyBookingLimit === null ? 'Không giới hạn lịch' : `${plan.monthlyBookingLimit} lịch/tháng`}</small><i aria-hidden="true">{selectedPlan === plan.code ? '✓' : '+'}</i></button>)}</div>}
                {planError && <p className="zen-consult-notice" role="alert">Vui lòng chọn một gói dịch vụ.</p>}
              </section>
              {consultationError && <p className="zen-consult-notice" role="alert">{consultationError}</p>}<div className="zen-consult-submit-area"><Button type="submit" loading={consultationSubmitting} disabled={consultationSubmitting || publicPlansLoading || publicPlansError || publicPlans.length === 0} className="zen-button zen-consult-submit">Gửi đăng ký tiệm <span>↗</span></Button><small>Chúng tôi chỉ gửi email khi hồ sơ được duyệt.</small></div>
            </form>
          </section>
        </div>}
        {consultationToast && <aside className="zen-success-toast" role="status" aria-live="polite"><span className="zen-success-toast-icon" aria-hidden="true">✓</span><div><strong>Đăng ký thành công</strong><p>Hồ sơ đã được tiếp nhận. ZenBook sẽ gửi email nếu hồ sơ được duyệt.</p></div><button type="button" onClick={() => { if (consultationToastTimerRef.current !== null) window.clearTimeout(consultationToastTimerRef.current); consultationToastTimerRef.current = null; setConsultationToast(false); }} aria-label="Đóng thông báo">×</button></aside>}

        <section className="zen-hero">
          <div className="zen-hero-copy zen-reveal">
            <AnimatedHeroHeadline />
            <Text className="zen-hero-desc">Giới thiệu dịch vụ và giá trên một đường dẫn riêng để khách xem, chọn giờ và gửi yêu cầu. Bạn quản lý lịch hẹn, nhân viên và ca làm trong workspace của tiệm.</Text>
            <Group className="zen-hero-actions"><Button className="zen-button zen-consult-open" aria-expanded={consultationOpen} aria-controls={consultationOpen ? 'zen-consult-panel' : undefined} onClick={openConsultation}>Bắt đầu ngay <span>↗</span></Button></Group>
            <div className="zen-proof-note"><span className="zen-proof-icon">✓</span><span><b>Không cần tự xây trang đặt lịch</b><small>Chia sẻ đường dẫn của tiệm để khách xem dịch vụ và giá.</small></span></div>
          </div>
          <div className="zen-hero-visual zen-reveal"><div className="zen-glow"/><div className="zen-device-stage"><div className="zen-laptop"><div className="zen-laptop-screen"><CalendarPreview /></div><div className="zen-laptop-hinge"/><div className="zen-laptop-base" aria-hidden="true"><div className="zen-laptop-keyboard">{['Esc F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 Del','` 1 2 3 4 5 6 7 8 9 0 - = Back','Tab Q W E R T Y U I O P [ ] \\','Caps A S D F G H J K L ; Enter','Shift Z X C V B N M , . / Shift','Ctrl Fn Alt Space Alt Fn L U D R'].map((row,index)=><div className="zen-laptop-key-row" key={index}>{row.split(' ').map((key,keyIndex)=><span className={`zen-laptop-key${['Tab','Caps','Enter','Shift','Back','Ctrl'].includes(key)?' is-wide':''}${key==='Space'?' is-space':''}`} key={`${key}-${keyIndex}`}/>)}</div>)}</div><div className="zen-laptop-trackpad"/></div></div><BookingPreview /><div className="zen-floating-tag"><span>↗</span><div><b>Đặt lịch mọi lúc</b><small>Qua đường dẫn của tiệm</small></div></div></div></div>
        </section>

        <section id="audience" className="zen-audience" aria-labelledby="zen-audience-title"><div className="zen-audience-heading zen-reveal"><span className="zen-kicker">DÀNH CHO CÁC TIỆM DỊCH VỤ</span><h2 id="zen-audience-title">Một trang đặt lịch cho nhiều mô hình tiệm.</h2><p>Từ cửa tiệm nhỏ đến đội ngũ đang phát triển — khách xem dịch vụ, giá và gửi yêu cầu qua đường dẫn riêng của tiệm.</p></div><div className="zen-audience-grid">{services.map((item) => <article className="zen-audience-item zen-reveal" key={item.name}><span className="zen-audience-icon"><ServiceIcon type={item.icon}/></span><div className="zen-audience-copy"><h3>{item.name}</h3><p>{item.detail}</p><ul>{item.bullets.map((bullet)=><li key={bullet}>{bullet}</li>)}</ul></div></article>)}</div></section>

        <section id="benefits" className="zen-section zen-benefits"><div className="zen-section-heading zen-reveal"><span className="zen-kicker">TẬP TRUNG VÀO ĐIỀU KHÁCH CẦN</span><Title order={2}>Dịch vụ rõ ràng. Đặt lịch dễ dàng.</Title><Text>Khách xem thông tin cần thiết để chọn dịch vụ; bạn theo dõi lịch tiệm mà không phải tự xây một hệ thống đặt lịch riêng.</Text></div><div className="zen-benefit-grid">
          <Paper className="zen-benefit-card zen-benefit-featured zen-reveal"><ThemeIcon className="zen-benefit-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M4 9.5h16M8 13h3m-3 4h6"/></svg></ThemeIcon><h3>Lịch hẹn dễ theo dõi</h3><p>Xem thời gian, dịch vụ và trạng thái lịch hẹn trong workspace để biết tiệm cần xử lý việc gì tiếp theo.</p><div className="zen-card-decoration">◷</div></Paper>
          <Paper className="zen-benefit-card zen-reveal"><ThemeIcon className="zen-benefit-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.2l1.7-1.7"/></svg></ThemeIcon><h3>Trang đặt lịch riêng</h3><p>Giới thiệu dịch vụ, giá và giờ hẹn trên đường dẫn của tiệm để khách xem rồi gửi yêu cầu trực tuyến.</p><div className="zen-card-decoration zen-card-decoration-link" aria-hidden="true"><svg viewBox="0 0 120 120"><path d="M49 71 37 83a20 20 0 0 1-28-28l23-23a20 20 0 0 1 28 0m11 17 12-12a20 20 0 0 1 28 28L88 88a20 20 0 0 1-28 0M40 80l40-40"/></svg></div></Paper>
          <Paper className="zen-benefit-card zen-reveal"><ThemeIcon className="zen-benefit-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg></ThemeIcon><h3>Quản lý tiệm một nơi</h3><p>Cập nhật dịch vụ, nhân viên và ca làm; chọn bảng màu cho trang đặt lịch và workspace của tiệm.</p><div className="zen-card-decoration zen-card-decoration-layers" aria-hidden="true"><svg viewBox="0 0 120 120"><path d="m60 12 48 25-48 25L12 37l48-25Zm-48 43 48 25 48-25M12 68l48 25 48-25M12 86l48 25 48-25"/></svg></div></Paper>
        </div></section>

        <section id="how-it-works" className="zen-section zen-how"><div className="zen-section-heading zen-reveal"><span className="zen-kicker">BẮT ĐẦU ĐƠN GIẢN</span><Title order={2}>Có trang đặt lịch mà không phải tự làm web.</Title><Text>Thiết lập thông tin tiệm, dịch vụ, nhân viên và ca làm; sau đó chia sẻ đường dẫn để khách xem giá, chọn giờ và gửi yêu cầu. Lịch hẹn được theo dõi trong workspace.</Text><Text className="zen-how-note">Khách đặt lịch trực tiếp trên trình duyệt, không cần cài ứng dụng.</Text></div><div className="zen-steps">{[['01','Tạo workspace','Thiết lập không gian quản lý riêng cho tiệm.'],['02','Cài thông tin tiệm','Thêm dịch vụ, nhân viên và giờ làm cơ bản.'],['03','Chia sẻ trang đặt lịch','Gửi đường dẫn để khách xem dịch vụ, giá và giờ phù hợp.'],['04','Theo dõi lịch hẹn','Xem yêu cầu và trạng thái lịch trong workspace.']].map(([n,title,desc])=><div className="zen-step zen-reveal" key={n}><span>{n}</span><div><b>{title}</b><p>{desc}</p></div><i>↗</i></div>)}</div></section>

        <section id="pricing" className="zen-section zen-pricing"><div className="zen-section-heading zen-reveal"><span className="zen-kicker">CHI PHÍ RÕ RÀNG</span><Title order={2}>Chọn gói theo quy mô tiệm.</Title><Text>Xem giá và hạn mức lịch hẹn, nhân viên ngay trên từng gói. Bắt đầu với lựa chọn phù hợp để có trang đặt lịch và workspace quản lý cho tiệm.</Text></div>{publicPlansLoading ? <PricingSkeleton /> : publicPlansError ? <div className="zen-pricing-error" role="alert"><div><strong>Chưa tải được bảng giá</strong><p>Kiểm tra kết nối rồi thử lại. Giá và hạn mức sẽ lấy từ hệ thống.</p></div><button type="button" className="zen-plan-retry" onClick={() => void loadPublicPlans()}>Thử tải lại</button></div> : publicPlans.length === 0 ? <div className="zen-pricing-empty" role="status"><strong>Chưa có gói dịch vụ để hiển thị</strong><p>Vui lòng quay lại sau.</p></div> : <div className="zen-pricing-grid">
          {publicPlans.map((plan, index) => <Paper className={`zen-plan-card zen-reveal zen-plan-tier-${index + 1}${index === 1 ? ' is-featured' : ''}`} key={`${plan.code}-${plan.version}`}>{index === 1 && <span className="zen-plan-badge">ĐỀ XUẤT</span>}<h3>{plan.displayName}</h3><p className="zen-plan-description">Gói dịch vụ theo quy mô vận hành lịch hẹn của tiệm.</p><div className="zen-plan-price"><strong>{plan.priceVnd.toLocaleString('vi-VN')}<small>đ</small></strong><span>/tháng</span></div><ul><li>Tối đa {plan.activeStaffLimit} hồ sơ nhân viên</li><li>{plan.monthlyBookingLimit === null ? 'Không giới hạn lịch đặt' : `Tối đa ${plan.monthlyBookingLimit} lịch đặt mỗi tháng`}</li>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><Button onClick={() => { setSelectedPlan(plan.code); openConsultation(); }} className={index === 1 ? 'zen-button' : 'zen-plan-secondary'}>{plan.priceVnd === 0 ? 'Dùng miễn phí' : 'Bắt đầu'} <span>↗</span></Button></Paper>)}
        </div>}</section>

        <section id="faq" className="zen-section zen-faq"><div className="zen-section-heading zen-reveal"><span className="zen-kicker">CÂU HỎI THƯỜNG GẶP</span><Title order={2}>Mọi điều cần biết trước khi bắt đầu.</Title><Text>Chọn cách nhận lịch mới sẽ ảnh hưởng đến trải nghiệm của khách và nhịp vận hành mỗi ngày. Dưới đây là những điều cần biết về cách đặt lịch, workspace, chi phí và bước đăng ký.</Text><a className="zen-faq-contact" href="#pricing">Xem bảng giá và hạn mức <span>→</span></a></div><div className="zen-faq-grid"><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>ZenBook phù hợp với mô hình dịch vụ nào?</span><i aria-hidden="true">+</i></summary><p>ZenBook phù hợp với tiệm và cơ sở nhận khách theo lịch—từ salon, nail, massage dưỡng sinh đến phòng khám thú y. Bạn tự thiết lập dịch vụ, nhân viên và khung giờ; khách đặt lịch trực tuyến, còn tiệm theo dõi mọi lịch hẹn trong workspace riêng.</p></details><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>Mỗi tiệm có trang đặt lịch riêng không?</span><i aria-hidden="true">+</i></summary><p>Có. Mỗi tiệm có đường dẫn đến trang đặt lịch riêng để gửi trực tiếp hoặc chia sẻ trên mạng xã hội hay website đang có. Trang hiển thị dịch vụ, giá và giờ còn trống để khách gửi yêu cầu; bạn không cần tự dựng thêm một website đặt lịch.</p></details><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>Sau khi khách gửi yêu cầu, lịch được xác nhận thế nào?</span><i aria-hidden="true">+</i></summary><p>Tùy cấu hình của tiệm, lịch có thể được xác nhận tự động hoặc chờ tiệm duyệt. Tiệm theo dõi trạng thái và quản lý lịch tập trung trong workspace; khách nhận liên kết quản lý lịch qua email nếu cung cấp địa chỉ.</p></details><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>Khách có cần tạo tài khoản hoặc cài ứng dụng không?</span><i aria-hidden="true">+</i></summary><p>Không. Khách mở đường dẫn đặt lịch của tiệm trên trình duyệt, chọn dịch vụ và giờ phù hợp rồi gửi thông tin liên hệ. Nếu cần quản lý lịch sau đó, khách có thể dùng liên kết bảo mật gửi riêng—không cần cài ứng dụng.</p></details><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>Tôi có thể quản lý dịch vụ, nhân viên và giao diện trang đặt lịch không?</span><i aria-hidden="true">+</i></summary><p>Có. Bạn có thể khai báo dịch vụ, thời lượng, giá, nhân viên phụ trách và giờ làm; đồng thời chọn bảng màu cho workspace và trang đặt lịch. ZenBook tập trung vào quản lý lịch, không thay thế công cụ chấm công, tính lương hay quản trị nhân sự chuyên sâu.</p></details><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>Giá và giới hạn của từng gói được tính ra sao?</span><i aria-hidden="true">+</i></summary><p>Mỗi gói hiển thị giá theo tháng, giới hạn hồ sơ nhân viên hoạt động và hạn mức lịch đặt hàng tháng. Giá và hạn mức hiện hành được trình bày ngay trên từng thẻ gói để bạn chọn theo quy mô tiệm.</p></details><details className="zen-faq-item zen-reveal" name="zen-faq"><summary><span>Gửi đăng ký xong, tôi có thể bắt đầu ngay không?</span><i aria-hidden="true">+</i></summary><p>Hồ sơ sẽ được gửi để ZenBook xem xét. Nếu được duyệt, chủ tiệm nhận email để thiết lập mật khẩu và truy cập workspace. Gói trả phí được chọn trong hồ sơ là nguyện vọng đăng ký; gửi form không tự kích hoạt thanh toán hoặc gói trả phí.</p></details></div></section>
        <section className="zen-cta zen-reveal">
          <div className="zen-cta-copy"><span className="zen-kicker">RÕ DỊCH VỤ, GIÁ VÀ CÁCH ĐẶT LỊCH</span><Title order={2}>Để khách chọn dịch vụ dễ hơn.<br/>Để tiệm quản lý lịch gọn hơn.</Title><Text>Tạo trang đặt lịch riêng, chia sẻ một đường dẫn và quản lý yêu cầu trong workspace — không cần tự xây, tự cập nhật website đặt lịch.</Text>
            <div className="zen-cta-points"><span><i aria-hidden="true">✓</i> Khách tự chọn dịch vụ và giờ hẹn</span><span><i aria-hidden="true">✓</i> Tiệm theo dõi lịch trong workspace riêng</span><span><i aria-hidden="true">✓</i> Có thể bắt đầu với gói miễn phí</span></div>
          </div>
          <div className="zen-cta-action"><Button onClick={openConsultation} className="zen-button zen-consult-open" aria-expanded={consultationOpen} aria-controls={consultationOpen ? 'zen-consult-panel' : undefined}>Bắt đầu ngay <span>↗</span></Button><small>Không cần cài ứng dụng cho khách đặt lịch.</small></div>
        </section>
        <div className="zen-footer-divider" aria-hidden="true" />
        <footer className="zen-footer">
          <div className="zen-footer-main zen-reveal">
            <div className="zen-footer-brand">
              <Anchor component={Link} href="/" className="zen-brand zen-brand-footer"><span className="zen-brand-mark">Z</span><span className="zen-brand-copy">Zen<span>Book</span><small>BOOKING, MADE CLEAR</small></span></Anchor>
              <p>Nền tảng đặt lịch dành cho tiệm và cơ sở dịch vụ. Khách tự chọn dịch vụ, tiệm dễ theo dõi lịch hẹn.</p>
            </div>
            <nav className="zen-footer-column" aria-label="Khám phá ZenBook"><h3>Khám phá</h3><a href="#audience">Ngành dịch vụ</a><a href="#benefits">Tính năng</a><a href="#how-it-works">Cách hoạt động</a></nav>
            <nav className="zen-footer-column" aria-label="Gói dịch vụ"><h3>Gói dịch vụ</h3><a href="#pricing">Bảng giá</a><button type="button" className="zen-consult-open" onClick={openConsultation}>Đăng ký tiệm</button><Link href="/login">Đăng nhập</Link></nav>
            <div className="zen-footer-column"><h3>Hỗ trợ</h3><a href="#faq">Câu hỏi thường gặp</a><button type="button" className="zen-consult-open" aria-expanded={consultationOpen} aria-controls={consultationOpen ? 'zen-consult-panel' : undefined} onClick={openConsultation}>Đăng ký tư vấn</button></div>
            <div className="zen-footer-column zen-footer-payments"><h3>Hỗ trợ thanh toán</h3><div className="zen-payment-badges" aria-label="Phương thức thanh toán dự kiến"><span className="zen-payment-momo"><img src="/payments/momo.svg" alt=""/><strong>MoMo</strong></span><span className="zen-payment-vietqr"><img src="/payments/vietqr.svg" alt="VietQR"/></span><span className="zen-payment-vnpay"><img src="/payments/vnpay.svg" alt="VNPAY"/></span></div></div>
          </div>
          <div className="zen-footer-bottom"><span>© ZenBook · Booking, made clear.</span></div>
        </footer>
        {showBackToTop && <a className="zen-back-top" href="#top" aria-label="Trở về đầu trang" title="Về đầu trang"><svg viewBox="0 0 40 40" aria-hidden="true"><circle className="zen-back-top-ring" cx="20" cy="20" r="17"/><circle ref={backToTopProgressRef} className="zen-back-top-progress" cx="20" cy="20" r="17" transform="rotate(-90 20 20)" strokeDasharray={2 * Math.PI * 17} strokeDashoffset={2 * Math.PI * 17}/><path className="zen-back-top-chevron" d="m14 19 6-5 6 5m-12 6 6-5 6 5"/></svg></a>}
        <Drawer opened={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="Khám phá ZenBook" position="right" size="xs" classNames={{ content: 'zen-mobile-drawer', header: 'zen-mobile-drawer-header', title: 'zen-mobile-drawer-title', close: 'zen-consult-modal-close' }}>
          <nav className="zen-mobile-menu" aria-label="Điều hướng mobile">{[['Ngành dịch vụ','#audience'],['Tính năng','#benefits'],['Cách hoạt động','#how-it-works'],['Bảng giá','#pricing'],['Câu hỏi thường gặp','#faq']].map(([label,href])=><a href={href} key={href} onClick={()=>setMobileNavOpen(false)}>{label}<span>↗</span></a>)}</nav>
          <Button className="zen-button zen-mobile-menu-cta zen-consult-open" aria-expanded={consultationOpen} aria-controls={consultationOpen ? 'zen-consult-panel' : undefined} onClick={()=>{setMobileNavOpen(false);openConsultation();}}>Bắt đầu ngay</Button>
        </Drawer>
      </Container>
    </main>
  );
}
