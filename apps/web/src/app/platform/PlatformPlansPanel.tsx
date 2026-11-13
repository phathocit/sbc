'use client';

import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import type { PlatformPlanDto, UpsertPlanRequest } from '@sbc/contracts';
import { api } from '@/lib/api';

type Draft = {
  code: string; displayName: string; priceVnd: string; activeStaffLimit: string;
  monthlyBookingLimit: string; sortOrder: string; featuresText: string; unlimited: boolean;
};

const blankDraft = (): Draft => ({ code: '', displayName: '', priceVnd: '', activeStaffLimit: '', monthlyBookingLimit: '', sortOrder: '', featuresText: '', unlimited: false });
const draftFromPlan = (plan: PlatformPlanDto): Draft => ({
  code: plan.code, displayName: plan.displayName, priceVnd: String(plan.priceVnd), activeStaffLimit: String(plan.activeStaffLimit),
  monthlyBookingLimit: plan.monthlyBookingLimit === null ? '' : String(plan.monthlyBookingLimit), sortOrder: String(plan.sortOrder),
  featuresText: plan.features.join('\n'), unlimited: plan.monthlyBookingLimit === null,
});

function money(value: number): string { return `${value.toLocaleString('vi-VN')} đ`; }

export default function PlatformPlansPanel({ plans, onChanged }: { plans: PlatformPlanDto[]; onChanged: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editingPlan, setEditingPlan] = useState<PlatformPlanDto | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PlatformPlanDto | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [bumping, setBumping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const hasEnteredData = Boolean(draft.code.trim() || draft.displayName.trim() || draft.priceVnd || draft.activeStaffLimit
    || draft.monthlyBookingLimit || draft.sortOrder || draft.featuresText.trim() || draft.unlimited);

  const closeModal = () => { setModalOpen(false); setConfirmClose(false); setEditingPlan(null); setDraft(blankDraft()); setError(''); };
  const nudge = () => { setBumping(true); window.setTimeout(() => setBumping(false), 430); };
  const requestClose = () => { if (hasEnteredData) setConfirmClose(true); else closeModal(); };
  const outsideClose = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (hasEnteredData) nudge(); else closeModal();
  };

  useEffect(() => {
    if (!modalOpen && !archiveTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmClose) { setConfirmClose(false); return; }
      if (modalOpen) requestClose(); else setArchiveTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const openCreate = () => { setEditingPlan(null); setDraft(blankDraft()); setError(''); setConfirmClose(false); setModalOpen(true); };
  const openEdit = (plan: PlatformPlanDto) => { setEditingPlan(plan); setDraft(draftFromPlan(plan)); setError(''); setConfirmClose(false); setModalOpen(true); };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const monthlyBookingLimit = draft.unlimited ? null : Number(draft.monthlyBookingLimit);
    if (!draft.unlimited && !draft.monthlyBookingLimit.trim()) { setError('Nhập giới hạn lịch hoặc chọn không giới hạn.'); return; }
    const payload: UpsertPlanRequest = {
      code: draft.code.trim().toLowerCase(), displayName: draft.displayName.trim(), priceVnd: Number(draft.priceVnd),
      activeStaffLimit: Number(draft.activeStaffLimit), monthlyBookingLimit, sortOrder: Number(draft.sortOrder),
      features: draft.featuresText.split('\n').map((value) => value.trim()).filter(Boolean),
    };
    setBusy(true); setError('');
    try {
      const created = await api.createPlatformPlanVersion(payload);
      setMessage(`${created.displayName} · phiên bản ${created.version} đã được xuất bản.`);
      closeModal(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không lưu được phiên bản gói.'); }
    finally { setBusy(false); }
  };

  const archive = async () => {
    if (!archiveTarget || busy) return;
    setBusy(true); setError('');
    try {
      const archived = await api.archivePlatformPlan(archiveTarget.id);
      setMessage(`${archived.displayName} đã được ngừng bán. Lịch sử và liên kết dữ liệu vẫn được giữ.`);
      setArchiveTarget(null); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không ngừng bán được gói.'); setArchiveTarget(null); }
    finally { setBusy(false); }
  };

  return <div className="platform-plan-manager">
    <div className="platform-plan-toolbar"><span>{plans.filter((plan) => plan.isActive).length} gói đang mở bán · {plans.length} phiên bản được lưu</span><button type="button" className="button button-primary" onClick={openCreate}>+ Thêm gói dịch vụ</button></div>
    {error && !modalOpen && <p className="notice notice-error" role="alert">{error}</p>}{message && <p className="notice notice-success" role="status">{message}</p>}
    <div className="platform-plan-grid">{plans.map((plan) => <article className={`platform-plan-card${plan.isActive ? ' is-active' : ' is-archived'}`} key={plan.id}>
      <header><div><span className={`pa-config-status ${plan.isActive ? 'is-ready' : 'is-muted'}`}>{plan.isActive ? 'Đang mở bán' : 'Đã lưu trữ'}</span><small>{plan.code} · phiên bản {plan.version}</small></div><span className="platform-plan-subscription-count">{plan.subscriptionCount} tenant dùng</span></header>
      <h2>{plan.displayName}</h2><div className="platform-plan-price">{money(plan.priceVnd)}<small>{plan.priceVnd ? '/ tháng' : '· miễn phí'}</small></div>
      <div className="platform-plan-limits"><span><strong>{plan.activeStaffLimit}</strong> hồ sơ nhân viên</span><span><strong>{plan.monthlyBookingLimit === null ? '∞' : plan.monthlyBookingLimit}</strong> lịch mỗi kỳ</span></div>
      <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      <footer>{plan.isActive ? <><button type="button" className="button button-secondary" onClick={() => openEdit(plan)}>Chỉnh sửa</button><button type="button" className="button button-danger-soft" disabled={plan.code === 'free'} title={plan.code === 'free' ? 'Gói miễn phí là gói nền bắt buộc.' : 'Ẩn khỏi bảng giá và lựa chọn gói trong form tư vấn; giữ tenant hiện tại'} onClick={() => setArchiveTarget(plan)}>Ngừng bán</button></> : <span className="platform-plan-history-note">Phiên bản cũ được giữ cho lịch sử và tenant còn tham chiếu.</span>}</footer>
    </article>)}</div>

    {modalOpen && <div className={`platform-plan-modal-backdrop${bumping ? ' is-bumping' : ''}`} role="presentation" onMouseDown={outsideClose}>
      <section className="platform-plan-modal" role="dialog" aria-modal="true" aria-labelledby="platform-plan-modal-title">
        <header><div><span className="eyebrow">CẤU HÌNH GÓI</span><h2 id="platform-plan-modal-title">{editingPlan ? `Phiên bản mới · ${editingPlan.displayName}` : 'Thêm gói dịch vụ'}</h2><p>{editingPlan ? 'Thay đổi sẽ tạo phiên bản mới; tenant cũ tiếp tục tham chiếu phiên bản đang dùng.' : 'Gói mới sẽ xuất hiện trong bảng giá và form đăng ký sau khi lưu.'}</p></div><button type="button" className="platform-plan-modal-close" aria-label="Đóng biểu mẫu" onClick={requestClose}>×</button></header>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <form onSubmit={submit}>
          <div className="platform-plan-fields">
            <label>Mã gói<input required maxLength={24} disabled={Boolean(editingPlan)} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="vd: salon_plus" /></label>
            <label>Tên gói<input required maxLength={80} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} placeholder="Tên hiển thị" /></label>
            <label>Giá mỗi tháng (VND)<input required type="number" min="0" max="2000000000" value={draft.priceVnd} onChange={(event) => setDraft({ ...draft, priceVnd: event.target.value })} /></label>
            <label>Nhân viên tối đa<input required type="number" min="1" max="100000" value={draft.activeStaffLimit} onChange={(event) => setDraft({ ...draft, activeStaffLimit: event.target.value })} /></label>
            <label>Lịch đặt mỗi kỳ<input type="number" min="0" max="10000000" disabled={draft.unlimited} required={!draft.unlimited} value={draft.monthlyBookingLimit} onChange={(event) => setDraft({ ...draft, monthlyBookingLimit: event.target.value })} /></label>
            <label>Thứ tự hiển thị<input required type="number" min="0" max="10000" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label>
            <label className="platform-plan-unlimited"><input type="checkbox" checked={draft.unlimited} onChange={(event) => setDraft({ ...draft, unlimited: event.target.checked, monthlyBookingLimit: '' })} /> Không giới hạn lịch</label>
            <label className="platform-plan-features">Quyền lợi · mỗi dòng một mục<textarea rows={5} maxLength={2500} value={draft.featuresText} onChange={(event) => setDraft({ ...draft, featuresText: event.target.value })} placeholder={'Workspace quản lý lịch hẹn\nBáo cáo lịch đặt theo tháng'} /></label>
          </div>
          <footer><button type="button" className="button button-secondary" onClick={requestClose}>Đóng</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Đang lưu…' : editingPlan ? 'Xuất bản phiên bản mới' : 'Tạo gói'}</button></footer>
        </form>
        {confirmClose && <div className="platform-plan-close-confirm"><section role="alertdialog" aria-labelledby="plan-close-title" aria-modal="true"><h3 id="plan-close-title">Bỏ thay đổi đang nhập?</h3><p>Thông tin trong biểu mẫu sẽ mất nếu đóng ngay.</p><div><button type="button" className="button button-secondary" onClick={() => setConfirmClose(false)}>Tiếp tục chỉnh sửa</button><button type="button" className="button button-danger-soft" onClick={closeModal}>Bỏ thay đổi</button></div></section></div>}
      </section>
    </div>}

    {archiveTarget && <div className="platform-plan-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveTarget(null); }}><section className="platform-plan-modal platform-plan-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-plan-title"><button type="button" className="platform-plan-modal-close" aria-label="Đóng" onClick={() => setArchiveTarget(null)}>×</button><span className="eyebrow">NGỪNG BÁN GÓI</span><h2 id="archive-plan-title">{archiveTarget.displayName}</h2><p>Gói sẽ không còn hiển thị trên bảng giá công khai và trong lựa chọn gói ở form tư vấn. {archiveTarget.subscriptionCount > 0 ? `${archiveTarget.subscriptionCount} tenant hiện tại tiếp tục dùng gói đến hết kỳ hiện tại.` : 'Không có tenant nào hiện đang dùng phiên bản này.'} Lịch sử tenant, đơn thanh toán và giao dịch đã khởi tạo được giữ nguyên; không xóa hay tự chuyển tenant.</p><footer><button type="button" className="button button-secondary" onClick={() => setArchiveTarget(null)}>Hủy</button><button type="button" className="button button-danger-soft" disabled={busy} onClick={() => void archive()}>{busy ? 'Đang xử lý…' : 'Xác nhận ngừng bán'}</button></footer></section></div>}
  </div>;
}
