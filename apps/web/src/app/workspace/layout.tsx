'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { TenantContextDto, TenantNotificationDto } from '@sbc/contracts';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';
import { tenantThemeStyle } from '@/lib/tenant-themes';
import { WorkspaceNotificationControlContext } from './WorkspaceNotificationControlContext';

type Membership = Awaited<ReturnType<typeof api.listTenants>>[number];

const navigation = [
  { href: '/workspace', label: 'Tổng quan', icon: 'overview' },
  { href: '/workspace/calendar', label: 'Lịch hẹn', icon: 'calendar' },
  { href: '/workspace/catalog?section=services', label: 'Dịch vụ', icon: 'catalog' },
  { href: '/workspace/catalog?section=staff', label: 'Nhân viên', icon: 'team' },
  { href: '/workspace/catalog?section=hours', label: 'Giờ làm', icon: 'hours' },
  { href: '/workspace/catalog?section=policies-exceptions', label: 'Chính sách & ngoại lệ', icon: 'policy' },
  { href: '/workspace/billing', label: 'Gói & thanh toán', icon: 'billing' },
  { href: '/workspace/notifications', label: 'Thông báo', icon: 'bell' },
  { href: '/workspace/settings', label: 'Cấu hình', icon: 'settings' },
  { href: '/workspace/appearance', label: 'Giao diện', icon: 'palette' },
] as const;

function Icon({ name }: { name: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" {...common}>
    {name === 'overview' && <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>}
    {name === 'calendar' && <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15h3M8 18h6"/></>}
    {name === 'bell' && <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>}
    {name === 'catalog' && <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/></>}
    {name === 'team' && <><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20zM16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V20h-4"/></>}
    {name === 'hours' && <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>}
    {name === 'policy' && <><path d="M12 3 19 6v5c0 4.7-2.9 8-7 10-4.1-2-7-5.3-7-10V6z"/><path d="m9 12 2 2 4-4"/></>}
    {name === 'billing' && <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>}
    {name === 'support' && <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-6.5a2.5 2.5 0 0 1-1-2z"/><path d="M8 8h8M8 12h5"/></>}
    {name === 'share' && <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.3 10.8 7.4-4.5M8.3 13.2l7.4 4.5"/></>}
    {name === 'settings' && <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 4.2 12H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></>}
    {name === 'palette' && <><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.4-2.9 1.7 1.7 0 0 1 1.3-2.8H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7.5" r=".8"/><circle cx="15" cy="7.5" r=".8"/></>}
    {name === 'external' && <><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></>}
    {name === 'logout' && <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M15 8l4 4-4 4M8 12h11"/></>}
  </svg>;
}

function TenantClock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [animationOffsets, setAnimationOffsets] = useState<{ second: number; minute: number; hour: number } | null>(null);
  useEffect(() => {
    let hasClockPhase = false;
    const update = () => {
      const instant = new Date();
      setNow(instant);
      if (hasClockPhase) return;
      hasClockPhase = true;
      try {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const seconds = Number(values.second) + instant.getMilliseconds() / 1000;
        const minutes = Number(values.minute) * 60 + seconds;
        setAnimationOffsets({ second: seconds, minute: minutes, hour: (Number(values.hour) % 12) * 3600 + minutes });
      } catch {
        const seconds = instant.getSeconds() + instant.getMilliseconds() / 1000;
        const minutes = instant.getMinutes() * 60 + seconds;
        setAnimationOffsets({ second: seconds, minute: minutes, hour: (instant.getHours() % 12) * 3600 + minutes });
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  let time = '--:--:--';
  let date = 'Đang tải giờ địa phương';
  if (now) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      time = `${values.hour}:${values.minute}:${values.second}`;
      date = formatWorkspaceDate(now, { weekday: 'long', timeZone: timezone });
    } catch {
      time = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
      date = formatWorkspaceDate(now, { weekday: 'long' });
    }
  }

  return <section className="owner-tenant-clock" aria-label={`Giờ địa phương của tiệm: ${date}, ${time}`}>
    <div className="owner-clock-face" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="17.25" />
        {Array.from({ length: 12 }, (_, index) => <line key={index} className={index % 3 === 0 ? 'is-major' : ''} x1="20" y1="5" x2="20" y2={index % 3 === 0 ? '8' : '6.5'} transform={`rotate(${index * 30} 20 20)`} />)}
        <line className="owner-clock-hand owner-clock-hour" x1="20" y1="20" x2="20" y2="11" style={animationOffsets ? { animationDelay: `-${animationOffsets.hour}s` } : undefined} />
        <line className="owner-clock-hand owner-clock-minute" x1="20" y1="20" x2="20" y2="7.5" style={animationOffsets ? { animationDelay: `-${animationOffsets.minute}s` } : undefined} />
        <line className="owner-clock-hand owner-clock-second" x1="20" y1="22" x2="20" y2="6.5" style={animationOffsets ? { animationDelay: `-${animationOffsets.second}s` } : undefined} />
        <circle className="owner-clock-pin" cx="20" cy="20" r="1.7" />
      </svg>
    </div>
    <div className="owner-clock-copy">
      <div className="owner-clock-readout"><time className="owner-clock-time" dateTime={now?.toISOString()}>{time}</time></div>
      <span className="owner-clock-date">{date}</span>
    </div>
  </section>;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationItems, setNotificationItems] = useState<TenantNotificationDto[]>([]);
  const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationActionBusy, setNotificationActionBusy] = useState(false);
  const [notificationActionError, setNotificationActionError] = useState('');
  const [notificationToast, setNotificationToast] = useState<TenantNotificationDto | null>(null);
  const [bookingShareOpen, setBookingShareOpen] = useState(false);
  const [bookingSharePosition, setBookingSharePosition] = useState<{ left: number; top: number } | null>(null);
  const [bookingShareUrl, setBookingShareUrl] = useState('');
  const [bookingShareMessage, setBookingShareMessage] = useState('');
  const notificationPopoverRef = useRef<HTMLElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const bookingSharePopoverRef = useRef<HTMLDivElement>(null);
  const bookingShareDesktopButtonRef = useRef<HTMLButtonElement>(null);
  const bookingShareMobileButtonRef = useRef<HTMLButtonElement>(null);
  const bookingShareAnchorRef = useRef<HTMLButtonElement | null>(null);
  const bookingQrRef = useRef<SVGSVGElement>(null);
  const [notificationPopoverPosition, setNotificationPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const lastNotificationId = useRef<string | null>(null);
  const notificationsInitialized = useRef(false);
  const notificationToastTimer = useRef<number | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await api.listTenants();
        if (!active) return;
        const available = rows.filter((row) => row.status === 'active' && row.tenant.status === 'active');
        const saved = localStorage.getItem('sbc_tenant_id');
        const selected = available.find((row) => row.tenant.id === saved) ?? available[0];
        if (!selected) { router.replace('/login'); return; }
        localStorage.setItem('sbc_tenant_id', selected.tenant.id);
        const tenant = await api.getCurrentTenant(selected.tenant.id);
        if (!active) return;
        setMemberships(available);
        setContext(tenant);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Không tải được không gian tiệm.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!context) return;
    setBookingShareUrl(new URL(`/public/${encodeURIComponent(context.tenant.slug)}`, window.location.origin).toString());
  }, [context?.tenant.slug]);

  useEffect(() => {
    const updateTheme = (event: Event) => {
      const detail = (event as CustomEvent<{ themeKey: string | null; themeMode: 'light' | 'dark' }>).detail;
      setContext((current) => current ? { ...current, themeKey: detail.themeKey as typeof current.themeKey, themeMode: detail.themeMode } : current);
    };
    window.addEventListener('tenant-theme-updated', updateTheme);
    return () => window.removeEventListener('tenant-theme-updated', updateTheme);
  }, []);

  const logout = async () => {
    await api.logout().catch(() => undefined);
    localStorage.removeItem('sbc_tenant_id');
    router.replace('/login');
  };

  useEffect(() => {
    if (!context || context.role !== 'owner') { setUnreadNotifications(0); return; }
    let active = true;
    const load = () => void api.listTenantNotifications(context.tenant.id).then((page) => {
      if (!active) return;
      const newest = page.items[0];
      if (newest && notificationsInitialized.current && newest.id !== lastNotificationId.current) {
        setNotificationToast(newest);
        if (notificationToastTimer.current) window.clearTimeout(notificationToastTimer.current);
        notificationToastTimer.current = window.setTimeout(() => setNotificationToast(null), 6000);
      }
      if (newest) lastNotificationId.current = newest.id;
      notificationsInitialized.current = true;
      setUnreadNotifications(page.unreadCount);
      if (notificationPopoverOpen) setNotificationItems(page.items.slice(0, 6));
    }).catch(() => undefined);
    load();
    const stop = api.connectTenantNotificationStream(context.tenant.id, load);
    window.addEventListener('focus', load);
    return () => { active = false; stop(); window.removeEventListener('focus', load); };
  }, [context?.tenant.id, context?.role, pathname, notificationPopoverOpen]);

  useEffect(() => () => { if (notificationToastTimer.current) window.clearTimeout(notificationToastTimer.current); }, []);

  useEffect(() => {
    if (!notificationPopoverOpen) return;
    const positionPopover = () => {
      const rect = notificationButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 28);
      const height = Math.min(560, window.innerHeight * 0.68);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const below = window.innerHeight - rect.bottom - 16;
      const top = below >= Math.min(height, 300) ? rect.bottom + 4 : Math.max(12, rect.top - height - 4);
      setNotificationPopoverPosition({ left, top });
    };
    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!notificationPopoverRef.current?.contains(target) && !notificationButtonRef.current?.contains(target)) setNotificationPopoverOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setNotificationPopoverOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => { window.removeEventListener('resize', positionPopover); window.removeEventListener('scroll', positionPopover, true); document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', closeEscape); };
  }, [notificationPopoverOpen]);

  useEffect(() => {
    if (!bookingShareOpen) return;
    const positionPopover = () => {
      const rect = bookingShareAnchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const height = Math.min(430, window.innerHeight - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const top = Math.max(12, rect.top - height - 8);
      setBookingSharePosition({ left, top });
    };
    positionPopover();
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (bookingSharePopoverRef.current?.contains(target)
        || bookingShareDesktopButtonRef.current?.contains(target)
        || bookingShareMobileButtonRef.current?.contains(target)) return;
      setBookingShareOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setBookingShareOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      window.removeEventListener('resize', positionPopover);
      window.removeEventListener('scroll', positionPopover, true);
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, [bookingShareOpen]);

  function toggleBookingShare(event: MouseEvent<HTMLButtonElement>) {
    const next = !bookingShareOpen;
    if (next) {
      bookingShareAnchorRef.current = event.currentTarget;
      const rect = event.currentTarget.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const height = Math.min(430, window.innerHeight - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const top = Math.max(12, rect.top - height - 8);
      setBookingSharePosition({ left, top });
      setBookingShareMessage('');
    }
    setBookingShareOpen(next);
  }

  async function copyBookingShareUrl() {
    if (!bookingShareUrl) return;
    try {
      await navigator.clipboard.writeText(bookingShareUrl);
      setBookingShareMessage('Đã sao chép link đặt lịch.');
    } catch {
      setBookingShareMessage('Không sao chép được. Bạn có thể chọn và sao chép link bên trên.');
    }
  }

  async function shareBookingUrl() {
    if (!bookingShareUrl || !context) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Đặt lịch · ${context.tenant.displayName}`, text: `Đặt lịch với ${context.tenant.displayName}`, url: bookingShareUrl });
        setBookingShareMessage('Đã mở bảng chia sẻ.');
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setBookingShareMessage('Không mở được bảng chia sẻ. Hãy sao chép link để gửi cho khách.');
      }
      return;
    }
    await copyBookingShareUrl();
  }

  function downloadBookingQr() {
    const svg = bookingQrRef.current;
    if (!svg || !context) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${context.tenant.slug}-dat-lich.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  async function markAllNotificationsRead() {
    if (!context || notificationActionBusy || unreadNotifications < 1) return;
    setNotificationActionBusy(true); setNotificationActionError('');
    try {
      await api.markAllTenantNotificationsRead(context.tenant.id);
      setNotificationItems((current) => current.map((item) => ({ ...item, isRead: true })));
      setUnreadNotifications(0);
    } catch (cause) {
      setNotificationActionError(cause instanceof Error ? cause.message : 'Không thể đánh dấu đã đọc tất cả.');
    } finally { setNotificationActionBusy(false); }
  }

  if (loading) return <main className="owner-state" role="status">Đang mở không gian tiệm…</main>;
  if (error || !context) return <main className="owner-state"><section><h1>Không mở được workspace</h1><p>{error || 'Vui lòng đăng nhập lại.'}</p><button className="button button-primary" onClick={() => void logout()}>Đăng nhập lại</button></section></main>;

  const allowed = navigation.filter((item) => (item.href !== '/workspace/billing' && item.href !== '/workspace/notifications' && item.href !== '/workspace/settings' && item.href !== '/workspace/appearance') || context.role === 'owner');
  const tenantNavigation = allowed;
  const requestedCatalogSection = searchParams.get('section');
  const requestedSchedule = searchParams.get('schedule');
  const catalogSection = requestedCatalogSection === 'staff-hours'
    ? (requestedSchedule === 'week' || requestedSchedule === 'month' ? 'hours' : 'staff')
    : requestedCatalogSection === 'policies' || requestedCatalogSection === 'exceptions'
      ? 'policies-exceptions'
      : requestedCatalogSection === 'services' || requestedCatalogSection === 'staff' || requestedCatalogSection === 'hours' || requestedCatalogSection === 'policies-exceptions'
        ? requestedCatalogSection
        : 'services';
  const isCurrentNavigationItem = (href: string) => {
    const [itemPath, itemQuery] = href.split('?');
    if (pathname !== itemPath) return false;
    if (itemPath !== '/workspace/catalog') return true;
    return new URLSearchParams(itemQuery).get('section') === catalogSection;
  };
  const notificationControl = context.role === 'owner' ? <button
    ref={notificationButtonRef}
    type="button"
    className={`owner-notification-bell${unreadNotifications > 0 ? ' has-unread' : ''}`}
    aria-label={`Thông báo${unreadNotifications ? `, ${unreadNotifications} chưa đọc` : ''}`}
    aria-expanded={notificationPopoverOpen}
    aria-haspopup="dialog"
    title="Thông báo"
    onClick={() => {
      const next = !notificationPopoverOpen;
      setNotificationPopoverOpen(next);
      if (next) {
        const rect = notificationButtonRef.current?.getBoundingClientRect();
        if (rect) {
          const width = Math.min(360, window.innerWidth - 28);
          const height = Math.min(560, window.innerHeight * 0.68);
          const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
          const below = window.innerHeight - rect.bottom - 16;
          setNotificationPopoverPosition({ left, top: below >= Math.min(height, 300) ? rect.bottom + 4 : Math.max(12, rect.top - height - 4) });
        }
        setNotificationLoading(true);
        setNotificationActionError('');
        void api.listTenantNotifications(context.tenant.id).then((page) => {
          setNotificationItems(page.items.slice(0, 6)); setUnreadNotifications(page.unreadCount);
        }).catch(() => undefined).finally(() => setNotificationLoading(false));
      }
    }}
  >
    <Icon name="bell" />
    {unreadNotifications > 0 && <i>{unreadNotifications > 99 ? '99+' : unreadNotifications}</i>}
  </button> : null;
  const isOverviewPage = pathname === '/workspace';
  const isNotificationsPage = pathname.startsWith('/workspace/notifications');
  const showContentNotificationControl = context.role === 'owner' && !isOverviewPage && !isNotificationsPage;
  return <div className={`owner-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`} data-tenant-theme={context.themeKey ?? (context.themeMode === 'dark' ? 'default' : undefined)} data-theme-mode={context.themeMode} style={tenantThemeStyle(context.themeKey, context.themeMode)}>
    {notificationToast && <aside className="owner-notification-toast" role="status"><button type="button" className="owner-notification-toast-open" onClick={() => {
      const item = notificationToast;
      setNotificationToast(null);
      void api.markTenantNotificationRead(context.tenant.id, item.id).catch(() => undefined);
      router.push(item.actionPath.startsWith('/workspace/') ? item.actionPath : '/workspace');
    }}><span>Thông báo mới</span><strong>{notificationToast.title}</strong><small>{notificationToast.description}</small></button><button type="button" className="owner-notification-toast-close" aria-label="Đóng thông báo" onClick={() => setNotificationToast(null)}>×</button></aside>}
    <aside className={`owner-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-label="Điều hướng workspace">
      <div className="owner-identity-box">
        <div className="owner-sidebar-head">
          <Link className="owner-brand" href="/workspace" aria-label={`Về tổng quan ${context.tenant.displayName}`}>
            <span className="owner-brand-mark">{context.tenant.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="owner-brand-copy"><strong>{context.tenant.displayName}</strong><small>{context.role === 'owner' ? 'Chủ tiệm' : context.role === 'admin' ? 'Quản lý' : context.role === 'receptionist' ? 'Lễ tân' : 'Nhân viên'}</small></span>
          </Link>
          <button type="button" className="owner-sidebar-toggle" aria-label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} title={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} aria-controls="owner-navigation" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg></button>
          <button type="button" className="owner-mobile-logout" aria-label="Đăng xuất" onClick={() => void logout()}><Icon name="logout"/></button>
        </div>
      <div className="owner-sidebar-status-row">
        <TenantClock timezone={context.location.timezone} />
        {notificationPopoverOpen && context.role === 'owner' && <section
          ref={notificationPopoverRef}
          className="owner-notification-popover"
          style={notificationPopoverPosition ? { left: notificationPopoverPosition.left, top: notificationPopoverPosition.top } : undefined}
          role="dialog"
          aria-label="Thông báo mới nhất"
        >
          <header>
            <strong>Thông báo</strong><span>{unreadNotifications} chưa đọc</span>
            {unreadNotifications > 0 && <button type="button" className="owner-notification-mark-all" disabled={notificationActionBusy} onClick={() => void markAllNotificationsRead()}>{notificationActionBusy ? 'Đang lưu…' : 'Đọc tất cả'}</button>}
          </header>
          {notificationActionError && <p className="owner-notification-action-error" role="alert">{notificationActionError}</p>}
          {notificationLoading ? <p className="owner-notification-popover-empty" role="status">Đang tải.</p> : notificationItems.length === 0 ? <p className="owner-notification-popover-empty">Chưa có thông báo.</p> : <div className="owner-notification-popover-list">
            {notificationItems.map((item) => <button type="button" key={item.id} className={`owner-notification-popover-item${item.isRead ? '' : ' is-unread'}`} onClick={() => {
              void api.markTenantNotificationRead(context.tenant.id, item.id).catch(() => undefined);
              setNotificationItems((current) => current.map((row) => row.id === item.id ? { ...row, isRead: true } : row));
              if (!item.isRead) setUnreadNotifications((count) => Math.max(0, count - 1));
              setNotificationPopoverOpen(false);
              router.push(item.actionPath.startsWith('/workspace/') ? item.actionPath : '/workspace');
            }}>
              <span className="owner-notification-popover-item-heading"><strong>{item.title}</strong><time dateTime={item.occurredAt}>{formatWorkspaceDate(item.occurredAt, { includeTime: true })}</time></span>
              <span className="owner-notification-popover-description">{item.description}</span>
            </button>)}
          </div>}
          <footer className="owner-notification-popover-footer"><Link href="/workspace/notifications" onClick={() => setNotificationPopoverOpen(false)}>Xem tất cả thông báo <span aria-hidden="true">→</span></Link></footer>
        </section>}
      </div>
      </div>
      {memberships.length > 1 && <label className="owner-tenant-switch">Chuyển tiệm<select aria-label="Chọn tiệm" value={context.tenant.id} onChange={(event) => { localStorage.setItem('sbc_tenant_id', event.target.value); window.location.reload(); }}>{memberships.map((row) => <option key={row.tenant.id} value={row.tenant.id}>{row.tenant.displayName}</option>)}</select></label>}
      <div className="owner-sidebar-divider" />
      <p className="owner-nav-caption">KHÔNG GIAN TIỆM</p>
      <nav id="owner-navigation" className="owner-navigation" aria-label="Mục quản lý">
        {tenantNavigation.map((item) => <Link key={item.href} href={item.href} className="owner-nav-link" title={item.label} aria-current={isCurrentNavigationItem(item.href) ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span></Link>)}
        {context.role === 'owner' && <button ref={bookingShareMobileButtonRef} type="button" className="owner-nav-link owner-mobile-share" title="Chia sẻ đặt lịch" aria-label="Chia sẻ đặt lịch" aria-expanded={bookingShareOpen} aria-controls="owner-booking-share-popover" onClick={toggleBookingShare}><Icon name="share"/><span>Chia sẻ đặt lịch</span></button>}
        {(context.role === 'owner' || context.role === 'admin') && <Link href="/workspace/support" className="owner-nav-link owner-mobile-support" title="Hỗ trợ" aria-current={pathname.startsWith('/workspace/support') ? 'page' : undefined}><Icon name="support"/><span>Hỗ trợ</span></Link>}
        <a className="owner-nav-link owner-mobile-public" href={`/public/${encodeURIComponent(context.tenant.slug)}`} target="_blank" rel="noreferrer"><Icon name="external"/><span>Trang đặt lịch</span></a>
      </nav>
      <div className="owner-sidebar-bottom">
        {context.role === 'owner' && <button ref={bookingShareDesktopButtonRef} type="button" className="owner-nav-link owner-booking-share-toggle" title="Chia sẻ đặt lịch" aria-label="Chia sẻ đặt lịch" aria-expanded={bookingShareOpen} aria-controls="owner-booking-share-popover" onClick={toggleBookingShare}><Icon name="share"/><span>Chia sẻ đặt lịch</span></button>}
        {(context.role === 'owner' || context.role === 'admin') && <Link href="/workspace/support" className="owner-nav-link" title="Hỗ trợ" aria-current={pathname.startsWith('/workspace/support') ? 'page' : undefined}><Icon name="support"/><span>Hỗ trợ</span></Link>}
        <a className="owner-nav-link" href={`/public/${encodeURIComponent(context.tenant.slug)}`} target="_blank" rel="noreferrer" title="Trang đặt lịch"><Icon name="external"/><span>Trang đặt lịch</span></a>
        <button type="button" className="owner-nav-link owner-logout" title="Đăng xuất" onClick={() => void logout()}><Icon name="logout"/><span>Đăng xuất</span></button>
      </div>
      {context.role === 'owner' && bookingShareOpen && <section
        ref={bookingSharePopoverRef}
        id="owner-booking-share-popover"
        className="owner-booking-share-popover"
        style={bookingSharePosition ? { left: bookingSharePosition.left, top: bookingSharePosition.top } : undefined}
        role="dialog"
        aria-label="Chia sẻ trang đặt lịch"
      >
        <header><div><strong>Chia sẻ đặt lịch</strong><small>Khách mở link để chọn dịch vụ và giờ hẹn.</small></div><button type="button" aria-label="Đóng" onClick={() => setBookingShareOpen(false)}>×</button></header>
        <label className="owner-booking-share-url-label">Link công khai</label>
        <input className="owner-booking-share-url" readOnly value={bookingShareUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Link đặt lịch công khai" />
      {(bookingShareUrl.includes('localhost') || bookingShareUrl.includes('127.0.0.1')) && <p className="owner-booking-share-local-note">Đây là link môi trường local, chỉ thiết bị có thể truy cập môi trường này mới mở được.</p>}
        <div className="owner-booking-share-actions"><button type="button" className="button button-secondary" onClick={() => void copyBookingShareUrl()}>Sao chép link</button><button type="button" className="button button-primary" onClick={() => void shareBookingUrl()}>Chia sẻ</button></div>
        <div className="owner-booking-share-qr">{bookingShareUrl ? <QRCodeSVG ref={bookingQrRef} value={bookingShareUrl} size={176} level="M" marginSize={4} bgColor="#ffffff" fgColor="#17251f" title={`Mã QR đặt lịch ${context.tenant.displayName}`} /> : <span>Đang tạo mã QR…</span>}<span>Quét mã để đặt lịch</span></div>
        <button type="button" className="owner-booking-share-download" disabled={!bookingShareUrl} onClick={downloadBookingQr}>Tải mã QR dạng SVG</button>
        {bookingShareMessage && <p className="owner-booking-share-message" role="status" aria-live="polite">{bookingShareMessage}</p>}
      </section>}
    </aside>
    <div className="owner-workarea"><div className={`owner-content${isOverviewPage ? ' owner-content-overview' : ''}${showContentNotificationControl ? ' has-notification-control' : ''}`}>
      {showContentNotificationControl && <div className="owner-notification-content-anchor">{notificationControl}</div>}
      <WorkspaceNotificationControlContext.Provider value={notificationControl}>{children}</WorkspaceNotificationControlContext.Provider>
    </div></div>
  </div>;
}
