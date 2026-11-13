'use client';

import { useEffect, useState } from 'react';
import { api, type TenantTelegramGroupCandidates, type TenantTelegramIntegrationStatus, type TenantTelegramLinkCode } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';
import type { TelegramIntegrationTestDto } from '@sbc/contracts';

function statusText(status: NonNullable<TenantTelegramIntegrationStatus>['status']) {
  if (status === 'verified') return 'Đã kiểm tra';
  if (status === 'saved') return 'Chưa kiểm tra';
  if (status === 'failed') return 'Cần kiểm tra lại';
  return 'Chưa cấu hình';
}

function statusTone(status: TenantTelegramIntegrationStatus['status']) {
  if (status === 'verified') return 'is-ready';
  if (status === 'failed') return 'is-error';
  return 'is-pending';
}

function dateTime(value: string | null | undefined) {
  if (!value) return '';
  return formatWorkspaceDate(value, { includeTime: true });
}

export default function WorkspaceSettingsPage() {
  const [tenantId, setTenantId] = useState('');
  const [owner, setOwner] = useState(false);
  const [status, setStatus] = useState<TenantTelegramIntegrationStatus | null>(null);
  const [testResult, setTestResult] = useState<TelegramIntegrationTestDto | null>(null);
  const [botToken, setBotToken] = useState('');
  const [linkCode, setLinkCode] = useState<TenantTelegramLinkCode | null>(null);
  const [candidates, setCandidates] = useState<TenantTelegramGroupCandidates['candidates']>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const id = localStorage.getItem('sbc_tenant_id') ?? '';
    setTenantId(id);
    if (!id) { setError('Không tìm thấy tiệm đang được chọn.'); setLoading(false); return; }
    void Promise.all([api.getCurrentTenant(id), api.getTenantTelegramIntegration(id)]).then(([context, integration]) => {
      setOwner(context.role === 'owner');
      setStatus(integration);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Không tải được cấu hình tích hợp.'))
      .finally(() => setLoading(false));
  }, []);

  async function runAction(action: string, task: () => Promise<TenantTelegramIntegrationStatus | TenantTelegramLinkCode | TenantTelegramGroupCandidates>) {
    setBusy(action); setError(''); setMessage('');
    try {
      const result = await task();
      if ('configured' in result) setStatus(result);
      else if ('commandText' in result) setLinkCode(result);
      else setCandidates(result.candidates);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không hoàn thành được thao tác.');
      return null;
    } finally { setBusy(''); }
  }

  async function saveToken() {
    if (!tenantId || !botToken.trim()) return;
    const result = await runAction('save', () => api.saveTenantTelegramIntegration(tenantId, { botToken: botToken.trim() }));
    if (result && 'configured' in result) {
      setBotToken(''); setLinkCode(null); setCandidates([]);
      setMessage('Đã lưu bot token mã hóa. Tiếp tục liên kết nhóm Telegram.');
    }
  }

  async function createLinkCode() {
    if (!tenantId) return;
    const result = await runAction('link', () => api.createTenantTelegramLinkCode(tenantId));
    if (result && 'commandText' in result) { setCandidates([]); setMessage('Mã liên kết có thời hạn ngắn. Gửi lệnh này trong đúng nhóm Telegram cần kết nối.'); }
  }

  async function discoverGroups() {
    if (!tenantId) return;
    const result = await runAction('discover', () => api.discoverTenantTelegramGroups(tenantId));
    if (result && 'candidates' in result) setMessage(result.candidates.length ? 'Chọn nhóm của tiệm để xác nhận liên kết.' : 'Chưa nhận được nhóm nào. Hãy gửi lệnh kết nối trong nhóm rồi thử lại.');
  }

  async function confirmGroup(chatId: string) {
    if (!tenantId) return;
    const result = await runAction('confirm', () => api.confirmTenantTelegramGroup(tenantId, { chatId }));
    if (result && 'configured' in result) { setCandidates([]); setLinkCode(null); setMessage('Đã liên kết nhóm. Kiểm tra kết nối để xác nhận bot có thể gửi tin nhắn.'); }
  }

  async function testIntegration() {
    if (!tenantId) return;
    setBusy('test'); setError(''); setMessage(''); setTestResult(null);
    try {
      const result = await api.testTenantTelegramIntegration(tenantId);
      setTestResult(result);
      setStatus(await api.getTenantTelegramIntegration(tenantId));
      setMessage(result.verified ? 'Kiểm tra thành công. Tin nhắn thử đã được gửi vào nhóm.' : 'Chưa xác nhận được khả năng gửi tin. Kiểm tra trạng thái và thử lại.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được tích hợp.');
      setStatus(await api.getTenantTelegramIntegration(tenantId).catch(() => status));
    } finally { setBusy(''); }
  }

  async function toggleEnabled() {
    if (!tenantId || !status) return;
    const nextEnabled = !status.enabled;
    const result = await runAction('toggle', () => api.setTenantTelegramEnabled(tenantId, nextEnabled));
    if (result && 'configured' in result) setMessage(nextEnabled ? 'Đã bật gửi thông báo Telegram.' : 'Đã tạm dừng gửi thông báo Telegram.');
  }

  async function copyLinkCommand() {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode.commandText);
      setMessage('Đã sao chép lệnh kết nối.');
    } catch {
      setMessage('Không sao chép được. Hãy chọn và sao chép lệnh trong khung.');
    }
  }

  if (loading) return <main className="owner-page" role="status">Đang tải cấu hình…</main>;
  if (!tenantId || !owner) return <main className="owner-page"><section className="notice notice-error" role="alert">{error || 'Chỉ chủ tiệm mới có thể cấu hình tích hợp.'}</section></main>;

  return <main className="owner-page owner-settings-page">
    <header className="owner-page-heading"><div><h1>Cấu hình</h1><p>Kết nối các dịch vụ mà tiệm sử dụng. Thông tin bí mật được lưu an toàn và không hiển thị lại sau khi lưu.</p></div></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {message && <p className="notice notice-success" role="status">{message}</p>}

    <details className="owner-integration-accordion" open>
      <summary>
        <span className="owner-integration-heading"><span className="owner-integration-mark" aria-hidden="true">T</span><span><strong>Telegram</strong><small>Gửi thông báo lịch hẹn vào nhóm Telegram của tiệm</small></span></span>
        <span className={`owner-integration-state ${statusTone(status?.status ?? 'not_configured')}`}>{statusText(status?.status ?? 'not_configured')}<span aria-hidden="true">⌄</span></span>
      </summary>
      <div className="owner-integration-body">
        <p className="owner-integration-intro">Thiết lập một lần để chủ tiệm nhận thông báo trong workspace và đồng bộ thông báo ngắn vào nhóm của tiệm. Nội dung gửi qua Telegram không bao gồm thông tin riêng của khách.</p>

        <ol className="owner-telegram-steps">
          <li><strong>Tạo bot riêng cho tiệm</strong><span>Mở <b>@BotFather</b> trên Telegram, gửi <code>/newbot</code> và làm theo hướng dẫn. Sao chép bot token BotFather cấp.</span></li>
          <li><strong>Lưu token tại đây</strong><span>Token được mã hóa khi lưu và không thể xem lại. Nếu tạo token mới, nhập token mới và lưu để thay thế.</span></li>
          <li><strong>Thêm bot vào nhóm tiệm</strong><span>Tạo hoặc mở nhóm Telegram của tiệm, thêm bot vừa tạo rồi gửi mã liên kết do ZenBook cấp.</span></li>
        </ol>

        <div className="owner-telegram-token-row">
          <label className="field-group">Bot token<input type="password" autoComplete="new-password" spellCheck={false} value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder={status?.configured ? 'Đã lưu token · nhập token mới để thay thế' : 'Dán token do @BotFather cấp'} maxLength={256} /></label>
          <button type="button" className="button button-primary" disabled={busy !== '' || !botToken.trim()} onClick={() => void saveToken()}>{busy === 'save' ? 'Đang lưu…' : status?.configured ? 'Thay token' : 'Lưu token'}</button>
        </div>

        {status?.configured && <section className="owner-telegram-link-card" aria-labelledby="telegram-link-heading">
          <div className="owner-telegram-link-heading"><div><h2 id="telegram-link-heading">Liên kết nhóm</h2><p>{status.group ? `Nhóm đã chọn: ${status.group.title}` : 'Tạo mã ngắn hạn để xác nhận đúng nhóm của tiệm.'}</p></div>{status.group && <span className="owner-integration-state is-ready">Đã liên kết</span>}</div>
          {!status.group && <div className="owner-telegram-link-actions">
            <button type="button" className="button button-secondary" disabled={busy !== ''} onClick={() => void createLinkCode()}>{busy === 'link' ? 'Đang tạo mã…' : 'Tạo mã liên kết'}</button>
            <button type="button" className="button button-secondary" disabled={busy !== '' || !linkCode} onClick={() => void discoverGroups()}>{busy === 'discover' ? 'Đang chờ tin nhắn…' : 'Tìm nhóm đã gửi mã'}</button>
          </div>}
          {linkCode && <div className="owner-telegram-command"><span>Lệnh gửi trong nhóm trước {dateTime(linkCode.expiresAt)}</span><code>{linkCode.commandText}</code><button type="button" className="owner-telegram-copy" onClick={() => void copyLinkCommand()}>Sao chép lệnh</button></div>}
          {candidates.length > 0 && <div className="owner-telegram-candidates"><strong>Nhóm gửi mã hợp lệ</strong>{candidates.map((candidate) => <div key={candidate.chatId}><span><b>{candidate.title || 'Nhóm Telegram'}</b><small>{candidate.type === 'supergroup' ? 'Nhóm Telegram' : 'Nhóm'}</small></span><button type="button" className="button button-primary" disabled={busy !== ''} onClick={() => void confirmGroup(candidate.chatId)}>Chọn nhóm này</button></div>)}</div>}
          {status.group && <div className="owner-telegram-link-actions"><button type="button" className="button button-secondary" disabled={busy !== ''} onClick={() => void testIntegration()}>{busy === 'test' ? 'Đang kiểm tra…' : 'Kiểm tra tích hợp'}</button><button type="button" className="button button-quiet" disabled={busy !== '' || status.status !== 'verified'} onClick={() => void toggleEnabled()}>{status.enabled ? 'Tạm dừng gửi' : 'Bật gửi thông báo'}</button></div>}
        </section>}

        {status && <section className="owner-telegram-status" aria-label="Trạng thái tích hợp Telegram">
          <div><span>Trạng thái</span><strong className={`owner-integration-state ${statusTone(status.status)}`}>{statusText(status.status)}{status.enabled ? ' · Đang gửi' : status.status === 'verified' ? ' · Đang tạm dừng' : ''}</strong></div>
          {status.botUsername && <div><span>Bot</span><strong>@{status.botUsername}</strong></div>}
          {status.group && <div><span>Nhóm</span><strong>{status.group.title}</strong></div>}
          <div><span>Kiểm tra gần nhất</span><strong>{dateTime(status.lastCheckedAt) || 'Chưa kiểm tra'}</strong></div>
          {status.lastDeliveryAt && <div><span>Thông báo gần nhất</span><strong>{status.lastDeliveryStatus === 'sent' ? 'Đã gửi' : 'Gửi thất bại'} · {dateTime(status.lastDeliveryAt)}</strong></div>}
          {status.lastErrorCode && <p role="status">Mã lỗi gần nhất: <code>{status.lastErrorCode}</code>. Kiểm tra token, quyền gửi tin của bot và nhóm đã liên kết.</p>}
          {status.lastDeliveryErrorCode && <p role="status">Lần gửi gần nhất chưa thành công: <code>{status.lastDeliveryErrorCode}</code>.</p>}
        </section>}
        {testResult && <p className={`owner-telegram-test-result ${testResult.verified ? 'is-success' : 'is-failure'}`} role="status">{testResult.verified ? `Đã gửi tin nhắn thử đến ${testResult.groupTitle || 'nhóm đã liên kết'} lúc ${dateTime(testResult.checkedAt)}.` : 'Không xác nhận được tin nhắn thử.'}</p>}
      </div>
    </details>
  </main>;
}
