'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TenantApplicationDto } from '@sbc/contracts';
import { api } from '@/lib/api';

function slugFromName(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [application, setApplication] = useState<TenantApplicationDto | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Ho_Chi_Minh');
  const [currency, setCurrency] = useState('VND');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const tenants = await api.listTenants();
    if (tenants.length > 0) {
      localStorage.setItem('sbc_tenant_id', tenants[0].tenant.id);
      router.replace('/workspace');
      return;
    }
    setAuthenticated(true);
    setApplication(await api.myTenantApplication());
  }, [router]);

  useEffect(() => {

    void refresh().catch(() => router.replace('/login')).finally(() => setLoading(false));
      .finally(() => setLoading(false));
  }, [refresh, router]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugFromName(value));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authenticated || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.submitTenantApplication({ name, slug, timezone, currency });
      setApplication(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không gửi được hồ sơ đăng ký.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="app-page"><div className="app-container"><div className="notice" role="status">Đang tải trạng thái đăng ký…</div></div></main>;

  return (
    <main className="app-page tenant-application-page">
      <div className="app-container tenant-application-container">
        <header className="app-topbar">
          <Link className="app-brand" href="/">SERVICE BUSINESS CLOUD</Link>
          <Link className="app-nav-link" href="/">Về trang chủ</Link>
        </header>
        <section className="tenant-application-card" aria-labelledby="tenant-application-title">
          <div className="tenant-application-heading">
            <span className="tenant-application-mark" aria-hidden="true">S</span>
            <p className="eyebrow">ĐĂNG KÝ KHÔNG GIAN KINH DOANH</p>
            <h1 id="tenant-application-title">Đưa lịch hẹn của tiệm lên một không gian riêng.</h1>
            <p>Gửi thông tin cơ bản để đội ngũ xem xét đăng ký. Sau khi được duyệt, tài khoản của bạn sẽ trở thành chủ tenant và có thể bắt đầu thiết lập dịch vụ.</p>
          </div>

          {error && <div className="notice notice-error" role="alert">{error}</div>}

          {application?.status === 'pending' && <section className="tenant-application-state is-pending" aria-live="polite">
            <span className="tenant-state-icon" aria-hidden="true">◷</span>
            <div><h2>Hồ sơ đang chờ xem xét</h2><p><strong>{application.name}</strong> · zenbook.vn/public/{application.slug}</p><p>Chúng tôi sẽ cập nhật trạng thái tại đây. Bạn có thể đăng xuất hoặc quay lại sau.</p><button type="button" className="button button-secondary" disabled={submitting} onClick={() => void refresh()}>Làm mới trạng thái</button></div>
          </section>}

          {application?.status === 'approved' && <section className="tenant-application-state is-approved" aria-live="polite"><span className="tenant-state-icon" aria-hidden="true">✓</span><div><h2>Tenant đã được duyệt</h2><p>Tài khoản đã có quyền owner cho <strong>{application.name}</strong>.</p><button type="button" className="button button-primary" onClick={() => router.push('/workspace')}>Mở workspace</button></div></section>}

          {application?.status === 'rejected' && <section className="tenant-application-state is-rejected" aria-live="polite"><span className="tenant-state-icon" aria-hidden="true">!</span><div><h2>Hồ sơ cần được cập nhật</h2><p>{application.reviewNote || 'Hồ sơ chưa được chấp thuận. Bạn có thể kiểm tra lại thông tin và gửi đăng ký mới.'}</p></div></section>}

          {(!application || application.status === 'rejected') && <form className="tenant-application-form" onSubmit={handleSubmit}>
            <div className="tenant-application-form-heading"><span>{application ? 'GỬI LẠI HỒ SƠ' : 'THÔNG TIN TIỆM'}</span><p>Thông tin sẽ được dùng để khởi tạo tenant nếu đăng ký được duyệt.</p></div>
            <label>Tên tiệm / cơ sở dịch vụ<input required maxLength={255} value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder="Ví dụ: Salon An Nhiên" autoComplete="organization" /></label>
            <label>Đường dẫn đặt lịch<input required minLength={3} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-')); }} placeholder="salon-an-nhien" /><small>Đường dẫn dự kiến: /public/{slug || 'ten-tiem'}</small></label>
            <div className="tenant-application-form-row">
              <label>Múi giờ<select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Ho_Chi_Minh">Việt Nam · UTC+7</option><option value="UTC">UTC</option><option value="Asia/Tokyo">Tokyo · UTC+9</option><option value="America/New_York">New York</option><option value="Europe/London">London</option></select></label>
              <label>Đơn vị tiền tệ<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="VND">VND · Việt Nam đồng</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option></select></label>
            </div>
            <button type="submit" className="button button-primary tenant-application-submit" disabled={submitting}>{submitting ? 'Đang gửi hồ sơ…' : 'Gửi đăng ký tenant'}</button>
            <small className="tenant-application-privacy">Gửi đăng ký không tự động tạo tenant hoặc công khai trang đặt lịch.</small>
          </form>}
        </section>
      </div>
    </main>
  );
}
