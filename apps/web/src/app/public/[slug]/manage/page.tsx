'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type {
	AvailabilitySlotDto,
	GuestSessionResponse,
	PublicBookingSummary,
} from '@sbc/contracts';
import { api } from '@/lib/api';

const field: React.CSSProperties = {
	width: '100%',
	padding: '0.75rem',
	border: '1px solid var(--line)',
	borderRadius: '0.6rem',
	font: 'inherit',
	background: '#fff',
	color: 'var(--ink)',
};
const bookingStatusLabel: Record<PublicBookingSummary['status'], string> = {
	PENDING: 'Đang chờ xác nhận',
	CONFIRMED: 'Đã xác nhận',
	CANCELLED: 'Đã hủy',
	COMPLETED: 'Hoàn tất',
	NO_SHOW: 'Vắng mặt',
	EXPIRED: 'Đã hết hạn',
};

export default function GuestManagePage() {
	const { slug } = useParams<{ slug: string }>();
	const [access, setAccess] = useState<GuestSessionResponse | null>(null);
	const [booking, setBooking] = useState<PublicBookingSummary | null>(null);
	const [tokenInput, setTokenInput] = useState('');
	const [bookingId, setBookingId] = useState('');
	const [email, setEmail] = useState('');
	const [date, setDate] = useState('');
	const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
	const [slot, setSlot] = useState('');
	const [showReschedule, setShowReschedule] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		const token = new URLSearchParams(window.location.hash.slice(1)).get(
			'token',
		);
		if (!token) return;
		// Remove the one-time credential from browser history before making any network request.
		window.history.replaceState(
			null,
			'',
			`${window.location.pathname}${window.location.search}`,
		);
		void redeem(token);
		// The token is consumed in this effect only and is never persisted.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function redeem(token: string) {
		setBusy(true);
		setError('');
		try {
			const session = await api.redeemGuestToken(slug, token);
			setAccess(session);
			setBookingId(session.bookingId);
			const summary = await api.guestBooking(
				slug,
				session.bookingId,
				session.accessToken,
			);
			setBooking(summary);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: 'Liên kết không hợp lệ hoặc đã hết hạn.',
			);
		} finally {
			setBusy(false);
		}
	}

	async function useToken(event: React.FormEvent) {
		event.preventDefault();
		if (!tokenInput.trim()) return;
		await redeem(tokenInput.trim());
		setTokenInput('');
	}

	async function requestLink(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError('');
		setMessage('');
		try {
			await api.requestGuestLink(slug, { bookingId, email });
			setMessage(
				'Yêu cầu được tiếp nhận. Nếu thông tin khớp, email sẽ được xử lý bất đồng bộ khi dịch vụ email đã cấu hình. Việc tiếp nhận chưa xác nhận email đã gửi.',
			);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : 'Không gửi được yêu cầu.',
			);
		} finally {
			setBusy(false);
		}
	}

	async function loadSlots(nextDate: string) {
		setDate(nextDate);
		setSlot('');
		setError('');
		setSlots([]);
		if (!booking || !nextDate) return;
		try {
			setSlots(await api.publicAvailability(slug, booking.serviceId, nextDate));
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : 'Không tải được giờ trống.',
			);
		}
	}

	async function cancelBooking() {
		if (!access || !booking || !window.confirm('Bạn muốn hủy lịch hẹn này?'))
			return;
		setBusy(true);
		setError('');
		setMessage('');
		try {
			const updated = await api.cancelGuestBooking(
				slug,
				booking.id,
				access.accessToken,
				crypto.randomUUID(),
			);
			setBooking(updated);
			setMessage('Đã gửi yêu cầu hủy lịch.');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Không thể hủy lịch.');
		} finally {
			setBusy(false);
		}
	}

	async function rescheduleBooking() {
		if (!access || !booking || !slot) return;
		setBusy(true);
		setError('');
		setMessage('');
		try {
			const updated = await api.rescheduleGuestBooking(
				slug,
				booking.id,
				access.accessToken,
				crypto.randomUUID(),
				{ startsAt: slot, staffSelection: 'ANY_AVAILABLE' },
			);
			setBooking(updated);
			setShowReschedule(false);
			setMessage('Đã cập nhật thời gian đặt lịch.');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Không thể đổi lịch.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className='app-page'>
			<div className='app-container' style={{ maxWidth: '54rem' }}>
				<header className='page-header-copy'>
					<p className='eyebrow'>QUẢN LÝ ĐẶT LỊCH</p>
					<h1 className='page-title'>Lịch hẹn của bạn</h1>
					<p className='page-description'>
						Xem lịch đã đặt hoặc mở lại liên kết quản lý được gửi qua email.
					</p>
				</header>
				{busy && !booking && (
					<p className='notice' role='status'>
						Đang xác thực liên kết…
					</p>
				)}
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
					</p>
				)}
				{message && (
					<p className='notice notice-success' role='status'>
						{message}
					</p>
				)}
				<section
					className='welcome-card'
					style={{ width: '100%', padding: 'clamp(1.25rem, 4vw, 2rem)' }}
				>
					{booking && access ? (
						<div style={{ marginTop: '1.5rem' }}>
							<p className='eyebrow'>CHI TIẾT LỊCH HẸN</p>
							<h2>{booking.serviceName}</h2>
							<p>
								Thời gian:{' '}
								{new Intl.DateTimeFormat('vi-VN', {
									dateStyle: 'full',
									timeStyle: 'short',
								}).format(new Date(booking.startsAt))}{' '}
								<span className='helper-text'>
									(theo múi giờ trên thiết bị)
								</span>
							</p>
							<p>
								Trạng thái:{' '}
								<span
									className={`status-pill ${booking.status === 'PENDING' ? 'status-pill-warning' : booking.status === 'CONFIRMED' || booking.status === 'COMPLETED' ? 'status-pill-success' : 'status-pill-danger'}`}
								>
									{bookingStatusLabel[booking.status]}
								</span>
							</p>
							<p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
								Phiên quản lý chỉ tồn tại trong bộ nhớ trang này và hết hạn sau
								một khoảng thời gian ngắn. Nếu tải lại trang, hãy mở lại liên
								kết.
							</p>
							<div
								style={{
									display: 'flex',
									flexWrap: 'wrap',
									gap: '0.65rem',
									marginTop: '1rem',
								}}
							>
								<button
									type='button'
									className='button button-secondary'
									disabled={
										busy || !['PENDING', 'CONFIRMED'].includes(booking.status)
									}
									onClick={() => setShowReschedule((value) => !value)}
								>
									Đổi lịch
								</button>
								<button
									type='button'
									className='button button-danger'
									disabled={
										busy || !['PENDING', 'CONFIRMED'].includes(booking.status)
									}
									onClick={cancelBooking}
								>
									Hủy lịch
								</button>
							</div>
							{showReschedule && (
								<section
									style={{
										display: 'grid',
										gap: '0.8rem',
										marginTop: '1rem',
										padding: '1rem',
										border: '1px solid var(--line)',
										borderRadius: '0.75rem',
									}}
								>
									<label
										style={{ display: 'grid', gap: '0.4rem', fontWeight: 700 }}
									>
										Ngày mới
										<input
											type='date'
											value={date}
											onChange={(e) => void loadSlots(e.target.value)}
											style={field}
										/>
									</label>
									<label
										style={{ display: 'grid', gap: '0.4rem', fontWeight: 700 }}
									>
										Giờ mới
										<select
											value={slot}
											onChange={(e) => setSlot(e.target.value)}
											style={field}
										>
											<option value=''>Chọn giờ</option>
											{slots.map((item) => (
												<option key={item.startsAt} value={item.startsAt}>
													{item.localStart}
												</option>
											))}
										</select>
									</label>
									<button
										type='button'
										className='button button-primary'
										disabled={busy || !slot}
										onClick={rescheduleBooking}
									>
										Lưu giờ mới
									</button>
								</section>
							)}
							<button
								type='button'
								className='button button-quiet'
								style={{ marginTop: '1rem' }}
								onClick={() => {
									setAccess(null);
									setBooking(null);
									setMessage('Phiên đã đóng.');
								}}
							>
								Đóng phiên quản lý
							</button>
						</div>
					) : (
						<div className='content-grid' style={{ marginTop: '1.5rem' }}>
							<section className='surface-card stack-md'>
								<div>
									<h2 className='surface-card-title'>
										Bạn còn liên kết quản lý?
									</h2>
									<p className='surface-card-description'>
										Mở liên kết trong email. Nếu được yêu cầu, dán token để xác
										thực phiên quản lý.
									</p>
								</div>
								{busy ? (
									<p className='helper-text' role='status'>
										Đang xử lý liên kết…
									</p>
								) : (
									<form onSubmit={useToken} className='stack-md'>
										<label className='field-group' htmlFor='guest-token'>
											Mã token
											<input
												id='guest-token'
												type='password'
												required
												value={tokenInput}
												onChange={(e) => setTokenInput(e.target.value)}
												autoComplete='off'
												style={field}
											/>
										</label>
										<button className='button button-primary'>
											Mở liên kết
										</button>
									</form>
								)}
							</section>
							<section className='surface-card stack-md'>
								<div>
									<h2 className='surface-card-title'>Không còn liên kết?</h2>
									<p className='surface-card-description'>
										Nhập mã đặt lịch và email đã dùng. Nếu thông tin khớp, hệ
										thống sẽ tiếp nhận yêu cầu gửi liên kết mới.
									</p>
								</div>
								<form onSubmit={requestLink} className='stack-md'>
									<label className='field-group' htmlFor='booking-id'>
										Mã đặt lịch
										<input
											id='booking-id'
											required
											value={bookingId}
											onChange={(e) => setBookingId(e.target.value)}
											style={field}
										/>
									</label>
									<label className='field-group' htmlFor='booking-email'>
										Email đã dùng khi đặt lịch
										<input
											id='booking-email'
											type='email'
											required
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											style={field}
										/>
									</label>
									<button className='button button-secondary' disabled={busy}>
										{busy ? 'Đang gửi yêu cầu…' : 'Yêu cầu liên kết mới'}
									</button>
								</form>
								<p className='helper-text'>
									Email được xử lý bất đồng bộ nếu dịch vụ gửi email đã cấu
									hình. Việc tiếp nhận yêu cầu chưa xác nhận email đã gửi; phản
									hồi không tiết lộ booking hoặc email có tồn tại hay không.
								</p>
							</section>
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
