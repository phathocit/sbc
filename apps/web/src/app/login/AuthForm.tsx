'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const access = await api.getAuthAccess();
        if (!active) return;
        if (access.platformAdmin) { router.replace('/platform'); return; }
        const memberships = await api.listTenants();
        if (!active) return;
        const available = memberships.filter((membership) => membership.status === 'active' && membership.tenant.status === 'active');
        const savedTenantId = localStorage.getItem('sbc_tenant_id');
        const tenant = available.find((membership) => membership.tenant.id === savedTenantId)
          ?? available.find((membership) => membership.role === 'owner' || membership.role === 'admin')
          ?? available[0];
        if (tenant) { localStorage.setItem('sbc_tenant_id', tenant.tenant.id); router.replace('/workspace'); }
        else router.replace('/onboarding');
      } catch { /* No active session: keep the login form available. */ }
    })();
    return () => { active = false; };
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      await api.login({ email: email.trim(), password });
      const access = await api.getAuthAccess();

      let destination = '/onboarding';
      if (access.platformAdmin) {
        destination = '/platform';
      } else {
        const memberships = await api.listTenants();
        const available = memberships.filter((membership) => membership.status === 'active' && membership.tenant.status === 'active');
        const savedTenantId = localStorage.getItem('sbc_tenant_id');
        const tenant = available.find((membership) => membership.tenant.id === savedTenantId)
          ?? available.find((membership) => membership.role === 'owner' || membership.role === 'admin')
          ?? available[0];

        if (tenant) {
          localStorage.setItem('sbc_tenant_id', tenant.tenant.id);
          destination = '/workspace';
        } else {
          localStorage.removeItem('sbc_tenant_id');
        }
      }

      localStorage.removeItem('sbc_token');
      localStorage.removeItem('sbc_user');
      router.replace(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Đăng nhập chưa thành công. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-login-page auth-sky">
      <div className="auth-login-shell">
        <section className="auth-login-story" aria-label="ZenBook">
          <div className="auth-welcome-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M20 11c0 8-4 12-12 12 8 0 12 4 12 12 0-8 4-12 12-12-8 0-12-4-12-12Z"/>
              <path d="M36 7c0 3-1.5 4.5-4.5 4.5 3 0 4.5 1.5 4.5 4.5 0-3 1.5-4.5 4.5-4.5C37.5 11.5 36 10 36 7Z"/>
            </svg>
          </div>
          <div className="auth-story-copy">
            <h1>Chào mừng trở lại.</h1>
            <p>Trang đặt lịch rõ ràng cho khách. Lịch hẹn và công việc gọn gàng cho tiệm.</p>
          </div>
          <div className="auth-device-scene" aria-label="Minh họa lịch hẹn workspace và trang đặt lịch trên điện thoại">
            <div className="auth-laptop"><div className="auth-laptop-screen"><small>ZENBOOK WORKSPACE</small><h3>Lịch hẹn hôm nay</h3><div className="auth-calendar-days">T2　 T3　 T4　 T5　 T6</div>{['09:00 · Chăm sóc thú cưng', '10:30 · Tư vấn dịch vụ', '14:00 · Lịch hẹn mới'].map((label) => <div className="auth-calendar-event" key={label}>{label}</div>)}</div><div className="auth-laptop-base" /></div>
            <div className="auth-phone"><span className="auth-phone-notch"/><small>ĐẶT LỊCH TRỰC TUYẾN</small><h3>Tiệm của bạn</h3><p>Chọn giờ thuận tiện</p><div className="auth-phone-service">Dịch vụ chăm sóc <span>›</span></div><div className="auth-phone-days"><span>06</span><strong>07</strong><span>08</span></div><div className="auth-phone-cta">Tiếp tục →</div></div>
          </div>
        </section>

        <section className="auth-login-form-panel" aria-labelledby="login-title">
          <Link className="auth-back-link" href="/">← <span>Về trang ZenBook</span></Link>

          <div className="auth-form-content">
            <span className="auth-form-kicker">CHÀO MỪNG TRỞ LẠI</span>
            <h2 id="login-title">Đăng nhập</h2>
            <p className="auth-form-intro">Nhập thông tin tài khoản để tiếp tục.</p>

            {error && <div className="auth-login-error" role="alert">{error}</div>}

            <form className={'auth-login-form' + (loading ? ' is-submitting' : '')} onSubmit={handleSubmit} aria-busy={loading}>
              <div className="auth-login-field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); if (error) setError(null); }}
                  placeholder="owner@example.com"
                />
              </div>

              <div className="auth-login-field">
                <label htmlFor="login-password">Mật khẩu</label>
                <div className="auth-password-control">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }}
                  placeholder="Nhập mật khẩu"
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.3 9.5 6.5a1.2 1.2 0 0 1 0 1 13 13 0 0 1-3.1 4.1M6.2 6.3A13.4 13.4 0 0 0 2.5 11.5a1.2 1.2 0 0 0 0 1C3.5 14.7 7 19 12 19c1 0 2-.2 2.9-.5"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
                </div>
              </div>

              <button type="submit" disabled={loading}>
                {loading ? <><span className="auth-submit-spinner" aria-hidden="true"/> Đang xác định không gian…</> : <>Đăng nhập <span aria-hidden="true">↗</span></>}
              </button>
            </form>
          </div>

          <div className="auth-form-legal">Không gian quản lý lịch hẹn của tiệm bạn</div>
        </section>
      </div>
    </main>
  );
}
