'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PlatformAdminBootstrapStatus, PlatformSettingsStatus, PlatformSettingsTestResult, PlatformSettingsTestSection } from '@sbc/contracts';
import { api } from '@/lib/api';
import { usePlatformTheme } from '../use-platform-theme';

function randomKeyHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

type SettingsSection = 'url' | 'smtp' | 'guest' | 'vnpay' | 'momo';

function uiTestResults(checks: PlatformSettingsStatus['checks']): Partial<Record<SettingsSection, PlatformSettingsTestResult>> {
  if (!checks) return {};
  return {
    ...(checks.publicUrl ? { url: checks.publicUrl } : {}),
    ...(checks.smtp ? { smtp: checks.smtp } : {}),
    ...(checks.guestToken ? { guest: checks.guestToken } : {}),
    ...(checks.vnpay ? { vnpay: checks.vnpay } : {}),
    ...(checks.momo ? { momo: checks.momo } : {}),
  };
}

export default function PlatformSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const { theme, toggleTheme } = usePlatformTheme();
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<PlatformAdminBootstrapStatus | null>(null);
  const [settings, setSettings] = useState<PlatformSettingsStatus | null>(null);
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [publicAppUrl, setPublicAppUrl] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('');
  const [smtpTestRecipient, setSmtpTestRecipient] = useState('');
  const [guestKeyId, setGuestKeyId] = useState('');
  const [guestKey, setGuestKey] = useState('');
  const [vnpayEnabled, setVnpayEnabled] = useState(false);
  const [vnpayMode, setVnpayMode] = useState<'sandbox' | 'production'>('sandbox');
  const [vnpayTmnCode, setVnpayTmnCode] = useState('');
  const [vnpayHashSecret, setVnpayHashSecret] = useState('');
  const [momoEnabled, setMomoEnabled] = useState(false);
  const [momoMode, setMomoMode] = useState<'sandbox' | 'production'>('sandbox');
  const [momoPartnerCode, setMomoPartnerCode] = useState('');
  const [momoAccessKey, setMomoAccessKey] = useState('');
  const [momoSecretKey, setMomoSecretKey] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [bootstrapUnavailable, setBootstrapUnavailable] = useState(false);
  const [editingSection, setEditingSection] = useState<SettingsSection | null>(null);
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null);
  const [unlockDialog, setUnlockDialog] = useState(false);
  const [testResults, setTestResults] = useState<Partial<Record<SettingsSection, PlatformSettingsTestResult>>>({});

  async function loadSettings() {
    const safe = await api.getPlatformSettings();
    setSettings(safe);
    setTestResults(uiTestResults(safe.checks));
    setPublicAppUrl(safe.publicAppUrl ?? '');
    setSmtpHost(safe.smtp.host ?? '');
    setSmtpPort(String(safe.smtp.port ?? 587));
    setSmtpSecure(safe.smtp.secure ?? false);
    setSmtpUsername(safe.smtp.username ?? '');
    setSmtpFromEmail(safe.smtp.fromEmail ?? '');
    setSmtpFromName(safe.smtp.fromName ?? '');
    // Secret fields are deliberately never hydrated from server responses.
    setSmtpPassword('');
    setGuestKey('');
    setVnpayEnabled(safe.paymentProviders.vnpay.enabled);
    setVnpayMode(safe.paymentProviders.vnpay.mode);
    setMomoEnabled(safe.paymentProviders.momo.enabled);
    setMomoMode(safe.paymentProviders.momo.mode);
    setVnpayTmnCode(''); setVnpayHashSecret('');
    setMomoPartnerCode(''); setMomoAccessKey(''); setMomoSecretKey('');
  }

  useEffect(() => {
    void (async () => {
      setError('');
      try {
        const state = await api.platformBootstrapStatus();
        setBootstrap(state);
        if (state.available) {
          setBootstrapUnavailable(false);
        } else if (!state.tokenConfigured && !state.adminInitialized) {
          setBootstrapUnavailable(true);
        } else {
          await loadSettings();
        }
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : 'Không tải được trạng thái cấu hình.';
        if (/forbidden|platform administrator|403/i.test(text)) setAccessDenied(true);
        else setError(text);
      } finally { setLoading(false); }
    })();
  }, [router]);

  async function bootstrapAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bootstrapToken) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.bootstrapPlatformAdmin(bootstrapToken);
      setBootstrapToken('');
      await loadSettings();
      setBootstrap({ available: false });
      setMessage('Đã khởi tạo quyền quản trị hệ thống cho tài khoản hiện tại.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không khởi tạo được quyền quản trị.');
      setBootstrapToken('');
    } finally { setBusy(false); }
  }

  function generateGuestKey() {
    setGuestKey(randomKeyHex());
    setGuestKeyId(`guest-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`);
  }

  function apiTestSection(section: SettingsSection): PlatformSettingsTestSection {
    return section === 'url' ? 'publicUrl' : section === 'guest' ? 'guestToken' : section;
  }

  function configTestBadge(section: SettingsSection, configured: boolean): string {
    const result = testResults[section];
    if (result?.status === 'passed') return 'Kiểm tra đạt';
    if (result?.status === 'partial') return 'Chỉ kiểm tra route';
    if (result?.status === 'failed') return 'Kiểm tra lỗi';
    return configured ? 'Đã lưu · chưa kiểm tra' : 'Chưa cấu hình';
  }

  function configTestTone(section: SettingsSection): string {
    const status = testResults[section]?.status;
    return status === 'passed' ? 'is-ready' : status === 'failed' ? 'is-error' : 'is-warning';
  }

  function testResultView(section: SettingsSection) {
    const result = testResults[section];
    if (!result) return <p className="helper-text" role="status">Chưa có kết quả kiểm tra được lưu. Lưu cấu hình không tự xác nhận khả năng hoạt động.</p>;
    const tone = result.status === 'passed' ? 'notice-success' : result.status === 'failed' ? 'notice-error' : '';
    return <p className={`notice ${tone}`} role="status" aria-live="polite">{result.message} <small>Kiểm tra lúc {new Date(result.checkedAt).toLocaleString('vi-VN')}</small></p>;
  }

  async function cancelEditing() {
    setEditingSection(null);
    setOpenSection(null);
    setError('');
    await loadSettings();
  }

  async function saveSettings(section: SettingsSection) {
    if (!unlocked || !currentPassword) { setUnlockDialog(true); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const dto: Parameters<typeof api.updatePlatformSettings>[0] = { currentPassword };
      if (section === 'url') dto.publicAppUrl = publicAppUrl.trim();
      if (section === 'smtp') dto.smtp = {
        host: smtpHost.trim(), port: Number(smtpPort), secure: smtpSecure,
        username: smtpUsername.trim(), password: smtpPassword,
        fromEmail: smtpFromEmail.trim(), fromName: smtpFromName.trim(),
      };
      if (section === 'guest') {
        if (!guestKey.trim() || !guestKeyId.trim()) throw new Error('Cần nhập mã phiên bản và khóa guest 64 ký tự hex.');
        dto.guestTokenKey = { keyId: guestKeyId.trim(), key: guestKey.trim() };
      }
      if (section === 'vnpay') dto.paymentProviders = { vnpay: {
        enabled: vnpayEnabled, mode: vnpayMode, tmnCode: vnpayTmnCode.trim(), hashSecret: vnpayHashSecret.trim(),
      } };
      if (section === 'momo') dto.paymentProviders = { momo: {
        enabled: momoEnabled, mode: momoMode, partnerCode: momoPartnerCode.trim(), accessKey: momoAccessKey.trim(), secretKey: momoSecretKey.trim(),
      } };
      const safe = await api.updatePlatformSettings(dto);
      setSettings(safe);
      setTestResults(uiTestResults(safe.checks));
      setSmtpPassword(""); setGuestKey(""); setVnpayTmnCode(""); setVnpayHashSecret("");
      setMomoPartnerCode(""); setMomoAccessKey(""); setMomoSecretKey("");
      setEditingSection(null); setOpenSection(null);
      setMessage('Đã lưu cấu hình. Trạng thái hoạt động sẽ chỉ được xác nhận sau khi kiểm tra. Máy chủ không gửi lại giá trị bí mật.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình.');
    } finally { setBusy(false); }
  }

  async function runTest(section: SettingsSection) {
    if (!unlocked || !currentPassword) { setUnlockDialog(true); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.testPlatformSettings({
        section: apiTestSection(section), currentPassword,
        ...(section === 'smtp' ? { recipient: smtpTestRecipient.trim() } : {}),
      });
      setTestResults((previous) => ({ ...previous, [section]: result }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được cấu hình.');
    } finally { setBusy(false); }
  }

  async function unlockWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword) return;
    setBusy(true); setError('');
    try {
      await api.unlockPlatformSettings({ currentPassword });
      await loadSettings();
      setCurrentPassword(currentPassword);
      setUnlocked(true);
      setEditingSection(openSection);
      setUnlockDialog(false);
      setMessage('Đã mở khóa cấu hình cho phiên làm việc này.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không mở khóa được cấu hình.');
      setCurrentPassword('');
    } finally { setBusy(false); }
  }

  function lockSettings() {
    setUnlocked(false); setCurrentPassword(''); setEditingSection(null);
    setSmtpPassword(''); setGuestKey(''); setVnpayTmnCode(''); setVnpayHashSecret('');
    setMomoPartnerCode(''); setMomoAccessKey(''); setMomoSecretKey('');
    setUnlockDialog(false); setMessage('Cấu hình đã được khóa.'); setError('');
  }

  const toggleSection = (section: SettingsSection) => {
    const next = openSection === section ? null : section;
    setOpenSection(next);
    setEditingSection(next && unlocked ? next : null);
    setError(''); setMessage('');
  };
  if (loading) return <div className={`app-page platform-page platform-settings-page${embedded ? ' platform-settings-embedded' : ''}`} data-theme={theme}><div className="app-container" style={{ maxWidth: embedded ? 'none' : '58rem' }}><p className="notice" role="status" aria-live="polite">Đang tải trạng thái cấu hình hệ thống…</p></div></div>;

  return <div className={`app-page platform-page platform-settings-page${embedded ? ' platform-settings-embedded' : ''}`} data-theme={theme}>
    <div className="app-container" style={{ maxWidth: embedded ? 'none' : '58rem' }}>
      {!embedded && <header className="app-topbar">
        <Link className="platform-brand" href="/platform" aria-label="ZenBook Platform Admin"><span className="platform-brand-mark">Z</span><span>ZenBook<small>PLATFORM ADMIN</small></span></Link>
        <nav className="app-nav platform-nav" aria-label="Điều hướng quản trị">
          <Link className="app-nav-link" href="/platform">Tổng quan</Link>
          <Link className="app-nav-link" href="/platform/settings" aria-current="page">Cấu hình</Link>
        </nav>
        <button className="platform-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Chuyển sang chế độ ${theme === 'light' ? 'Warm Dark' : 'Soft Light'}`} aria-pressed={theme === 'dark'}><span aria-hidden="true">{theme === 'light' ? '☾' : '☼'}</span>{theme === 'light' ? 'Soft Light' : 'Warm Dark'}</button>
      </header>}
      {!embedded && <div className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">QUẢN TRỊ NỀN TẢNG</p>
          <h1 className="page-title">Cấu hình hệ thống</h1>
          <p className="page-description">Chỉ quản trị viên hệ thống mới có thể xem và thay đổi các thiết lập này.</p>
        </div>
      </div>}

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}

      {bootstrapUnavailable ? <section className="surface-card stack-md" aria-labelledby="bootstrap-unavailable-title">
        <h2 id="bootstrap-unavailable-title" className="surface-card-title">Chưa bật khởi tạo quản trị hệ thống</h2>
        <p className="page-description">Chưa có quản trị viên hệ thống và API chưa nhận <code>PLATFORM_BOOTSTRAP_TOKEN</code>. Người vận hành cần cấu hình token bootstrap và <code>APP_CONFIG_MASTER_KEY</code> ở máy chủ, sau đó khởi động lại API.</p>
      </section> : accessDenied ? <section className="surface-card stack-md" role="alert" aria-labelledby="access-denied-title">
        <h2 id="access-denied-title" className="surface-card-title">Tài khoản hiện tại chưa có quyền quản trị hệ thống</h2>
        <p className="page-description">{bootstrap?.adminInitialized ? 'Quản trị viên đầu tiên đã được tạo bằng tài khoản khác. Hãy đăng nhập bằng tài khoản đó; quyền owner hoặc admin của doanh nghiệp không cấp quyền hệ thống.' : 'Tài khoản hiện tại chưa được cấp quyền quản trị hệ thống.'}</p>
        <Link className="button button-secondary" href="/platform">Về Platform Console</Link>
      </section> : bootstrap?.available ? <form onSubmit={bootstrapAdmin} className="surface-card stack-md">
        <div><h2 className="surface-card-title">Khởi tạo quản trị viên hệ thống</h2><p className="surface-card-description">Đây là bước thực hiện một lần. Đăng nhập bằng tài khoản của bạn rồi nhập token bootstrap đã cấu hình ở máy chủ.</p></div>
        <div className="field-group"><label htmlFor="bootstrap-token">Token bootstrap</label><input className="field" id="bootstrap-token" type="password" autoComplete="off" required value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></div>
        <p className="helper-text">Không nhập khóa gốc mã hóa vào trình duyệt. <code>APP_CONFIG_MASTER_KEY</code> và <code>PLATFORM_BOOTSTRAP_TOKEN</code> phải được cấu hình an toàn ngoài giao diện này.</p>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Đang khởi tạo…' : 'Khởi tạo quyền quản trị'}</button>
      </form> : settings && <div className="platform-settings-workspace">
        <section className="platform-settings-health" aria-label="Trạng thái nền tảng">
          <div><span className={`pa-config-status ${settings.encryptionReady ? 'is-ready' : 'is-error'}`}>{settings.encryptionReady ? 'Khóa mã hóa sẵn sàng' : 'Thiếu APP_CONFIG_MASTER_KEY'}</span><p>Thông tin trạng thái được lấy từ cấu hình máy chủ. Bí mật không được trả về giao diện.</p></div>
          <button type="button" className={`pa-settings-lock${unlocked ? ' is-unlocked' : ''}`} aria-label={unlocked ? 'Khóa cấu hình' : 'Mở khóa cấu hình'} aria-pressed={unlocked} title={unlocked ? 'Cấu hình đang mở khóa · nhấn để khóa' : 'Nhấn để mở khóa cấu hình'} disabled={busy} onClick={() => unlocked ? lockSettings() : (setCurrentPassword(''), setError(''), setUnlockDialog(true))}>
            {unlocked ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v1"/><circle cx="12" cy="15" r="1"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/><circle cx="12" cy="15" r="1"/></svg>}
            <span>{unlocked ? 'Đang mở khóa' : 'Cấu hình đang khóa'}</span>
          </button>
          {!settings.encryptionReady && <p className="notice notice-error">Cần cấu hình APP_CONFIG_MASTER_KEY trên máy chủ rồi khởi động lại API trước khi lưu.</p>}
        </section>
        {error && !unlockDialog && <p className="notice notice-error" role="alert">{error}</p>}
        {message && <p className="notice notice-success" role="status">{message}</p>}
        <div className="platform-settings-accordions">
          <details open={openSection === 'url'}>
            <summary onClick={(event) => { event.preventDefault(); toggleSection('url'); }}><span><strong>Địa chỉ ứng dụng công khai</strong><small>Đường dẫn dùng cho booking và điều hướng chủ tiệm</small></span><span className="platform-settings-summary-actions"><span className={`pa-config-status ${configTestTone('url')}`}>{configTestBadge('url', Boolean(settings.publicAppUrl))}</span></span></summary>
            <div className="pa-config-body"><p>Giá trị hiện tại: <code>{settings.publicAppUrl || 'Chưa có địa chỉ'}</code></p><div className="pa-config-actions"><button type="button" className="button button-secondary" disabled={!unlocked || !settings.publicAppUrl || busy} onClick={() => void runTest('url')}>Kiểm tra địa chỉ</button></div>{testResultView('url')}{editingSection === 'url' && <><label className="pa-config-field pa-config-field-medium">Origin web công khai<input className="field" type="url" inputMode="url" required placeholder="https://booking.example.com" value={publicAppUrl} onChange={(event) => setPublicAppUrl(event.target.value)} /><small>Chỉ nhập origin, không có đường dẫn, query hoặc fragment. Môi trường production cần HTTPS.</small></label><div className="pa-config-actions"><button type="button" className="button button-secondary" onClick={() => void cancelEditing()}>Hủy</button><button type="button" className="button button-primary" disabled={!unlocked || !settings.encryptionReady || busy} onClick={() => void saveSettings('url')}>{settings.publicAppUrl ? 'Cập nhật cấu hình' : 'Lưu cấu hình'}</button></div></>}</div>
          </details>

          <details open={openSection === 'smtp'}>
            <summary onClick={(event) => { event.preventDefault(); toggleSection('smtp'); }}><span><strong>Email thông báo · SMTP</strong><small>Máy chủ gửi email booking, lời mời và thông báo</small></span><span className="platform-settings-summary-actions"><span className={`pa-config-status ${configTestTone('smtp')}`}>{configTestBadge('smtp', settings.smtp.configured)}</span></span></summary>
            <div className="pa-config-body">{settings.smtp.configured && <p>Máy chủ: <code>{settings.smtp.host}:{settings.smtp.port}</code> · Người gửi: <code>{settings.smtp.fromEmail}</code> · Mật khẩu {settings.smtp.passwordConfigured ? 'đã lưu' : 'chưa có'}</p>}<div className="pa-config-fields"><label className="pa-config-field pa-config-field-medium">Email nhận thử<input className="field" type="email" autoComplete="email" value={smtpTestRecipient} onChange={(event) => setSmtpTestRecipient(event.target.value)} placeholder="email-cua-ban@example.com" /></label><button type="button" className="button button-secondary" disabled={!unlocked || !settings.smtp.configured || !smtpTestRecipient.trim() || busy} onClick={() => void runTest('smtp')}>Gửi email thử</button></div>{testResultView('smtp')}{editingSection === 'smtp' && <>
              <div className="pa-config-fields"><label className="pa-config-field pa-config-field-medium">Máy chủ<input className="field" required value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" /></label><label className="pa-config-field pa-config-field-short">Cổng<input className="field" required type="number" min={1} max={65535} value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} /></label><label className="pa-config-checkbox"><input type="checkbox" checked={smtpSecure} onChange={(event) => setSmtpSecure(event.target.checked)} /> TLS trực tiếp (thường dùng cổng 465)</label>
                <label className="pa-config-field">Tên đăng nhập<input className="field" autoComplete="off" value={smtpUsername} onChange={(event) => setSmtpUsername(event.target.value)} /></label><label className="pa-config-field">Mật khẩu mới<input className="field" type="password" autoComplete="new-password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} placeholder={settings.smtp.passwordConfigured ? 'Để trống để giữ mật khẩu hiện tại' : 'Nhập mật khẩu SMTP'} /></label><label className="pa-config-field">Email người gửi<input className="field" required type="email" value={smtpFromEmail} onChange={(event) => setSmtpFromEmail(event.target.value)} /></label><label className="pa-config-field">Tên người gửi<input className="field" value={smtpFromName} onChange={(event) => setSmtpFromName(event.target.value)} /></label></div>
              <p className="helper-text">Trạng thái “đã lưu” chỉ xác nhận có thông tin cấu hình; chưa xác minh máy chủ SMTP nhận kết nối hoặc gửi thư thành công.</p><div className="pa-config-actions"><button type="button" className="button button-secondary" onClick={() => void cancelEditing()}>Hủy</button><button type="button" className="button button-primary" disabled={!unlocked || !settings.encryptionReady || busy} onClick={() => void saveSettings('smtp')}>{settings.smtp.configured ? 'Cập nhật cấu hình' : 'Lưu cấu hình'}</button></div>
            </>}</div>
          </details>

          <details open={openSection === 'guest'}>
            <summary onClick={(event) => { event.preventDefault(); toggleSection('guest'); }}><span><strong>Khóa token khách</strong><small>Ký liên kết bảo mật để khách quản lý lịch hẹn</small></span><span className="platform-settings-summary-actions"><span className={`pa-config-status ${configTestTone('guest')}`}>{settings.guestToken.configured ? `${configTestBadge('guest', true)} · ${settings.guestToken.activeKeyId}` : 'Chưa cấu hình'}</span></span></summary>
            <div className="pa-config-body">{settings.guestToken.keyIds.length > 0 && <p>Phiên bản khóa còn lưu để xử lý email đang chờ: <code>{settings.guestToken.keyIds.join(', ')}</code></p>}<div className="pa-config-actions"><button type="button" className="button button-secondary" disabled={!unlocked || !settings.guestToken.configured || busy} onClick={() => void runTest('guest')}>Kiểm tra khóa</button></div>{testResultView('guest')}{editingSection === 'guest' && <>
              <div className="pa-config-fields"><label className="pa-config-field pa-config-field-medium">ID phiên bản mới<input className="field" autoComplete="off" value={guestKeyId} onChange={(event) => setGuestKeyId(event.target.value)} /></label><label className="pa-config-field pa-config-field-medium">Khóa mới · 64 ký tự hex<input className="field" type="password" autoComplete="new-password" spellCheck={false} value={guestKey} onChange={(event) => setGuestKey(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={generateGuestKey}>Tạo khóa ngẫu nhiên</button></div><p className="helper-text">Khi xoay khóa, khóa cũ được giữ để giải mã email đã xếp hàng. Không dùng lại ID cho giá trị khóa khác.</p><div className="pa-config-actions"><button type="button" className="button button-secondary" onClick={() => void cancelEditing()}>Hủy</button><button type="button" className="button button-primary" disabled={!unlocked || !settings.encryptionReady || !guestKey || !guestKeyId || busy} onClick={() => void saveSettings('guest')}>{settings.guestToken.configured ? 'Cập nhật cấu hình' : 'Lưu cấu hình'}</button></div>
            </>}</div>
          </details>

          <details open={openSection === 'vnpay'}>
            <summary onClick={(event) => { event.preventDefault(); toggleSection('vnpay'); }}><span><strong>Thanh toán · VNPAY</strong><small>Merchant configuration, IPN callback và môi trường</small></span><span className="platform-settings-summary-actions"><span className={`pa-config-status ${testResults.vnpay?.status === 'partial' ? 'is-warning' : testResults.vnpay?.status === 'failed' ? 'is-error' : 'is-muted'}`}>{!settings.paymentProviders.vnpay.configured ? 'Chưa cấu hình' : !settings.paymentProviders.vnpay.enabled ? 'Đã lưu · đang tắt' : configTestBadge('vnpay', true)}</span></span></summary>
            <div className="pa-config-body">{settings.paymentCallbackUrls && <p>IPN URL: <code>{settings.paymentCallbackUrls.vnpay}</code></p>}<div className="pa-config-actions"><button type="button" className="button button-secondary" disabled={!unlocked || !settings.paymentProviders.vnpay.configured || !settings.paymentCallbackUrls || busy} onClick={() => void runTest('vnpay')}>Kiểm tra IPN</button></div>{testResultView('vnpay')}{editingSection === 'vnpay' && <>
              <div className="pa-config-fields"><label className="pa-config-field pa-config-field-short">Môi trường<select className="field" value={vnpayMode} onChange={(event) => setVnpayMode(event.target.value as 'sandbox' | 'production')}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label><label className="pa-config-field pa-config-field-medium">TmnCode<input className="field" autoComplete="off" value={vnpayTmnCode} onChange={(event) => setVnpayTmnCode(event.target.value)} placeholder={settings.paymentProviders.vnpay.configured ? 'Để trống để giữ giá trị đã lưu' : 'Mã website VNPAY'} /></label><label className="pa-config-field pa-config-field-medium">HashSecret<input className="field" type="password" autoComplete="new-password" value={vnpayHashSecret} onChange={(event) => setVnpayHashSecret(event.target.value)} placeholder={settings.paymentProviders.vnpay.configured ? 'Để trống để giữ giá trị đã lưu' : 'Khóa ký VNPAY'} /></label><label className="pa-config-checkbox"><input type="checkbox" checked={vnpayEnabled} onChange={(event) => setVnpayEnabled(event.target.checked)} /> Cho phép thanh toán VNPAY</label></div><p className="helper-text">Kiểm tra route chỉ xác nhận IPN công khai có phản hồi. Giao dịch thành công sẽ được đánh dấu đã xác minh khi backend nhận IPN có chữ ký hợp lệ hoặc đối soát QueryDR thành công.</p><div className="pa-config-actions"><button type="button" className="button button-secondary" onClick={() => void cancelEditing()}>Hủy</button><button type="button" className="button button-primary" disabled={!unlocked || !settings.encryptionReady || busy} onClick={() => void saveSettings('vnpay')}>{settings.paymentProviders.vnpay.configured ? 'Cập nhật cấu hình' : 'Lưu cấu hình'}</button></div>
            </>}</div>
          </details>

          <details open={openSection === 'momo'}>
            <summary onClick={(event) => { event.preventDefault(); toggleSection('momo'); }}><span><strong>Thanh toán · MoMo</strong><small>Merchant configuration và kết quả xác nhận sandbox</small></span><span className="platform-settings-summary-actions"><span className={`pa-config-status ${testResults.momo?.status === 'partial' ? 'is-warning' : testResults.momo?.status === 'failed' ? 'is-error' : 'is-muted'}`}>{!settings.paymentProviders.momo.configured ? 'Chưa cấu hình' : !settings.paymentProviders.momo.enabled ? 'Đã lưu · đang tắt' : configTestBadge('momo', true)}</span></span></summary>
            <div className="pa-config-body">{settings.paymentCallbackUrls && <p>IPN URL gửi trong yêu cầu tạo giao dịch: <code>{settings.paymentCallbackUrls.momo}</code></p>}<div className="pa-config-actions"><button type="button" className="button button-secondary" disabled={!unlocked || !settings.paymentProviders.momo.configured || !settings.paymentCallbackUrls || busy} onClick={() => void runTest('momo')}>Kiểm tra IPN</button></div>{testResultView('momo')}{editingSection === 'momo' && <>
              <div className="pa-config-fields"><label className="pa-config-field pa-config-field-short">Môi trường<select className="field" value={momoMode} onChange={(event) => setMomoMode(event.target.value as 'sandbox' | 'production')}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label><label className="pa-config-field pa-config-field-medium">PartnerCode<input className="field" autoComplete="off" value={momoPartnerCode} onChange={(event) => setMomoPartnerCode(event.target.value)} placeholder={settings.paymentProviders.momo.configured ? 'Để trống để giữ giá trị đã lưu' : 'PartnerCode MoMo'} /></label><label className="pa-config-field pa-config-field-medium">AccessKey<input className="field" type="password" autoComplete="new-password" value={momoAccessKey} onChange={(event) => setMomoAccessKey(event.target.value)} placeholder={settings.paymentProviders.momo.configured ? 'Để trống để giữ giá trị đã lưu' : 'AccessKey MoMo'} /></label><label className="pa-config-field pa-config-field-medium">SecretKey<input className="field" type="password" autoComplete="new-password" value={momoSecretKey} onChange={(event) => setMomoSecretKey(event.target.value)} placeholder={settings.paymentProviders.momo.configured ? 'Để trống để giữ giá trị đã lưu' : 'SecretKey MoMo'} /></label><label className="pa-config-checkbox"><input type="checkbox" checked={momoEnabled} onChange={(event) => setMomoEnabled(event.target.checked)} /> Cho phép thanh toán MoMo</label></div><p className="helper-text">Kiểm tra IPN chỉ xác nhận route công khai phản hồi; merchant MoMo chỉ được xác nhận bằng giao dịch sandbox thành công.</p><div className="pa-config-actions"><button type="button" className="button button-secondary" onClick={() => void cancelEditing()}>Hủy</button><button type="button" className="button button-primary" disabled={!unlocked || !settings.encryptionReady || busy} onClick={() => void saveSettings('momo')}>{settings.paymentProviders.momo.configured ? 'Cập nhật cấu hình' : 'Lưu cấu hình'}</button></div>
            </>}</div>
          </details>
        </div>
      </div>}
      {unlockDialog && <div className="pa-confirm-backdrop" role="presentation"><form className="pa-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="pa-confirm-title" onSubmit={unlockWithPassword}>
        <button type="button" className="pa-confirm-close" aria-label="Đóng mở khóa" onClick={() => { setUnlockDialog(false); setCurrentPassword(''); setError(''); }}>×</button>
        <p className="eyebrow">BẢO VỆ CẤU HÌNH</p><h2 id="pa-confirm-title">Mở khóa cấu hình</h2><p>Nhập mật khẩu quản trị để chỉnh sửa và kiểm tra cấu hình. Cấu hình sẽ tự khóa khi bạn rời tab này.</p>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <label className="pa-config-field">Mật khẩu quản trị<input className="field" type="password" autoComplete="current-password" required autoFocus value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <div className="pa-config-actions"><button type="button" className="button button-secondary" onClick={() => { setUnlockDialog(false); setCurrentPassword(''); setError(''); }}>Hủy</button><button className="button button-primary" type="submit" disabled={busy || !currentPassword}>{busy ? 'Đang xác minh…' : 'Mở khóa'}</button></div>
      </form></div>}
    </div>
  </div>;
}
