'use client';

import { useEffect, useState } from 'react';
import type { PlatformTelegramIntegrationDto, PlatformTelegramPairingCodeDto } from '@sbc/contracts';
import { api } from '@/lib/api';

export default function PlatformTelegramSettings({ unlocked, currentPassword }: { unlocked: boolean; currentPassword: string }) {
  const [state, setState] = useState<PlatformTelegramIntegrationDto | null>(null);
  const [botToken, setBotToken] = useState('');
  const [pairing, setPairing] = useState<PlatformTelegramPairingCodeDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { void api.getPlatformTelegram().then(setState).catch((cause) => setError(cause instanceof Error ? cause.message : 'Không tải được kết nối Telegram.')); }, []);
  useEffect(() => { if (!unlocked) { setEditing(false); setBotToken(''); setPairing(null); } }, [unlocked]);

  async function run(action: () => Promise<PlatformTelegramIntegrationDto>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { const next = await action(); setState(next); setBotToken(''); if (!next.chatId) setPairing(null); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không xử lý được Telegram.'); }
    finally { setBusy(false); }
  }

  const statusLabel = !state?.configured ? 'Chưa cấu hình' : state.status === 'failed' ? 'Kiểm tra lỗi' : state.enabled ? 'Đang hoạt động' : state.status === 'verified' ? 'Đã xác minh · đang tắt' : 'Đã lưu · chưa kiểm tra';
  return <details className="platform-telegram-settings">
    <summary><span><strong>Thông báo và hỗ trợ · Telegram</strong><small>Nhận sự kiện quản trị và trả lời ticket trong chat riêng đã xác minh</small></span><span className="platform-settings-summary-actions"><span className={`pa-config-status ${state?.enabled ? 'is-ready' : state?.status === 'failed' ? 'is-error' : 'is-warning'}`}>{statusLabel}</span></span></summary>
    <div className="pa-config-body">
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}
      <p>Bot: <strong>{state?.botUsername ? `@${state.botUsername}` : 'Chưa xác minh'}</strong> · Chat admin: <strong>{state?.chatName ?? state?.chatId ?? 'Chưa chọn'}</strong></p>
      <p className="helper-text">Tạo bot riêng cho Platform bằng BotFather, lưu token, tạo mã ghép và gửi lệnh đó trong chat riêng với bot. Sau khi ghép, kiểm tra kết nối và bật. Không dùng chung bot của nhóm tenant vì hai luồng long polling sẽ tranh nhau nhận tin. Chỉ admin đã kiểm tra thành công từ chat đó mới được trả lời ticket. Worker cần chạy để nhận và gửi tin.</p>
      {state?.lastCheckedAt && <p className="helper-text">Kiểm tra: {new Date(state.lastCheckedAt).toLocaleString('vi-VN')} · Lỗi: {state.lastErrorCode ?? 'không có'} · Gửi gần nhất: {state.lastDeliveryStatus ?? 'chưa gửi'}{state.lastDeliveryErrorCode ? ` (${state.lastDeliveryErrorCode})` : ''} · Nhận gần nhất: {state.lastInboundAt ? new Date(state.lastInboundAt).toLocaleString('vi-VN') : 'chưa có'}</p>}
      <div className="pa-config-actions">
        <button type="button" className="button button-secondary" disabled={!unlocked || busy} onClick={() => setEditing((value) => !value)}>{editing ? 'Đóng chỉnh sửa' : state?.configured ? 'Chỉnh sửa cấu hình' : 'Cấu hình'}</button>
        <button type="button" className="button button-secondary" disabled={!unlocked || busy || !state?.configured || state.enabled} onClick={async () => { setBusy(true); setError(''); setMessage(''); try { setPairing(await api.createPlatformTelegramPairingCode({ currentPassword })); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được mã ghép.'); } finally { setBusy(false); } }}>Tạo mã ghép chat</button>
        <button type="button" className="button button-secondary" disabled={!unlocked || busy || !pairing || state?.enabled} onClick={async () => { setBusy(true); setError(''); setMessage(''); try { const result = await api.discoverPlatformTelegramChats({ currentPassword }); if (result.candidates.length) { setState(await api.getPlatformTelegram()); setPairing(null); setMessage(`Đã ghép chat ${result.candidates[0].name}. Hãy kiểm tra kết nối.`); } else setMessage('Chưa thấy lệnh ghép trong chat riêng. Hãy gửi lệnh rồi thử lại.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không ghép được chat.'); } finally { setBusy(false); } }}>Ghép chat đã gửi mã</button>
        <button type="button" className="button button-secondary" disabled={!unlocked || busy || !state?.configured || !state.chatId} onClick={() => void run(() => api.testPlatformTelegram({ currentPassword }), 'Telegram đã gửi tin thử đến chat admin và lưu trạng thái xác minh.')}>Kiểm tra kết nối</button>
        {state?.status === 'verified' && <button type="button" className={state.enabled ? 'button button-secondary' : 'button button-primary'} disabled={!unlocked || busy} onClick={() => void run(() => api.savePlatformTelegram({ currentPassword, enabled: !state.enabled }), state.enabled ? 'Đã tắt thông báo Telegram.' : 'Đã bật thông báo và phản hồi ticket qua Telegram.')}>{state.enabled ? 'Tắt kết nối' : 'Bật kết nối'}</button>}
      </div>
      {pairing && <p className="notice" role="status">Gửi <code>{pairing.commandText}</code> trong chat riêng với bot trước {new Date(pairing.expiresAt).toLocaleString('vi-VN')}, rồi bấm “Ghép chat đã gửi mã”.</p>}
      {editing && <div className="stack-md"><div className="pa-config-fields"><label className="pa-config-field pa-config-field-medium">Bot token mới<input className="field" type="password" autoComplete="off" spellCheck={false} value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder={state?.configured ? 'Để trống để giữ token đã mã hóa' : 'Token từ BotFather'} /></label></div><div className="pa-config-actions"><button type="button" className="button button-primary" disabled={!unlocked || busy || !botToken.trim()} onClick={() => void run(() => api.savePlatformTelegram({ currentPassword, botToken: botToken.trim() }), 'Đã lưu bot token. Hãy tạo mã ghép chat mới.')}>Lưu bot token</button></div></div>}
      <p className="helper-text">Để trả lời ticket: gửi <code>/reply MÃ_TICKET nội dung</code>, hoặc Reply trực tiếp vào tin báo ticket từ bot. Tin trả lời được ghi vào cùng lịch sử hỗ trợ trên web.</p>
    </div>
  </details>;
}
