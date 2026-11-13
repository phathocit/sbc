'use client';

import { useEffect, useState } from 'react';
import type { TenantContextDto, TenantThemeKey, TenantThemeMode } from '@sbc/contracts';
import { api } from '@/lib/api';
import { tenantThemes } from '@/lib/tenant-themes';

export default function WorkspaceAppearancePage() {
  const [tenantId, setTenantId] = useState('');
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<TenantThemeKey | null>(null);
  const [selectedMode, setSelectedMode] = useState<TenantThemeMode>('light');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const id = localStorage.getItem('sbc_tenant_id') ?? '';
    setTenantId(id);
    if (!id) { setError('Không tìm thấy tiệm đang được chọn.'); setLoading(false); return; }
    void api.getCurrentTenant(id).then((data) => {
      setContext(data);
      setSelectedTheme(data.themeKey);
      setSelectedMode(data.themeMode);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Không tải được giao diện.'))
      .finally(() => setLoading(false));
  }, []);

  async function saveTheme(themeKey: TenantThemeKey | null, themeMode: TenantThemeMode) {
    if (!tenantId) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await api.updateCurrentTenantTheme(tenantId, { themeKey, themeMode });
      setSelectedTheme(result.themeKey as TenantThemeKey | null);
      setSelectedMode(result.themeMode);
      setContext((current) => current ? { ...current, themeKey: result.themeKey as TenantThemeKey | null, themeMode: result.themeMode } : current);
      window.dispatchEvent(new CustomEvent('tenant-theme-updated', { detail: result }));
      setMessage('Đã lưu giao diện cho workspace và trang đặt lịch của tiệm.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được giao diện.');
    } finally { setSaving(false); }
  }

  if (loading) return <main className="owner-page"><p role="status">Đang tải giao diện…</p></main>;
  if (error && !context) return <main className="owner-page"><section className="notice notice-error" role="alert">{error}</section></main>;
  if (context?.role !== 'owner') return <main className="owner-page"><section className="notice" role="alert">Chỉ chủ tiệm mới có thể thay đổi giao diện.</section></main>;

  return <main className="owner-page owner-appearance-page">
    <header className="owner-page-heading"><div><h1>Giao diện tiệm</h1><p>Chọn bảng màu dùng đồng bộ trong workspace và trang đặt lịch công khai.</p></div></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {message && <p className="notice notice-success" role="status">{message}</p>}
    <div className="owner-appearance-toolbar"><div className="owner-appearance-controls"><div className="owner-theme-mode-switch" role="group" aria-label="Chế độ hiển thị"><button type="button" disabled={saving} aria-pressed={selectedMode === 'light'} className={selectedMode === 'light' ? 'is-active' : ''} onClick={() => setSelectedMode('light')}>☼ Sáng</button><button type="button" disabled={saving} aria-pressed={selectedMode === 'dark'} className={selectedMode === 'dark' ? 'is-active' : ''} onClick={() => setSelectedMode('dark')}>☾ Tối</button></div><button className="button button-secondary" type="button" disabled={saving || (selectedTheme === null && selectedMode === 'light')} onClick={() => { setSelectedTheme(null); setSelectedMode('light'); void saveTheme(null, 'light'); }}>Khôi phục giao diện mặc định</button></div></div>
    <div className="owner-theme-grid">
      {tenantThemes.map((theme) => <button key={theme.key} type="button" disabled={saving} className={`owner-theme-card${selectedTheme === theme.key ? ' is-selected' : ''}`} aria-pressed={selectedTheme === theme.key} onClick={() => setSelectedTheme(theme.key)}>
        <span className="owner-theme-swatches" aria-hidden="true"><i style={{ background: theme.primary }} /><i style={{ background: theme.secondary }} /><i style={{ background: theme.accent }} /><i style={{ background: theme.background }} /><i style={{ background: theme.surface }} /></span>
        <span className="owner-theme-copy"><strong>{theme.name}</strong><small>{theme.primary} · {theme.background}</small></span>
        <span className="owner-theme-radio" aria-hidden="true">{selectedTheme === theme.key ? '✓' : ''}</span>
      </button>)}
    </div>
    <div className="owner-appearance-actions"><p>Thay đổi sẽ được dùng chung cho chủ tiệm và các thành viên workspace, đồng thời hiển thị trên trang đặt lịch công khai.</p><button type="button" className="button button-primary" disabled={saving || (selectedTheme === context.themeKey && selectedMode === context.themeMode)} onClick={() => void saveTheme(selectedTheme, selectedMode)}>{saving ? 'Đang lưu…' : 'Lưu giao diện'}</button></div>
  </main>;
}
