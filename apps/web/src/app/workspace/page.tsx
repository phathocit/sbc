'use client';

import { useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';
import type { BookingCountPointDto, BookingDto, BookingRevenuePointDto, ServiceBookingCountDto, TenantContextDto, WorkingHourDto } from '@sbc/contracts';
import { WorkspaceNotificationControlContext } from './WorkspaceNotificationControlContext';

function greetingFor(hour: number, tenantName: string) {
  if (hour >= 5 && hour < 11) return { period: 'morning', text: `Chào buổi sáng, ${tenantName}` };
  if (hour >= 11 && hour < 13) return { period: 'noon', text: `Chào buổi trưa, ${tenantName}` };
  if (hour >= 13 && hour < 18) return { period: 'afternoon', text: `Chào buổi chiều, ${tenantName}` };
  if (hour >= 18 && hour < 22) return { period: 'evening', text: `Chào buổi tối, ${tenantName}` };
  return { period: 'late', text: `Khuya rồi sao còn thức, ${tenantName}` };
}

function GreetingIcon({ period }: { period: string }) {
  return <span className={`owner-greeting-icon is-${period}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none">
    {period === 'morning' && <><path d="M7 21a9 9 0 0 1 18 0"/><path d="M16 3v4M5.8 8.8l2.8 2.8M26.2 8.8l-2.8 2.8M3 22h26"/></>}
    {period === 'noon' && <><circle cx="16" cy="16" r="6"/><path d="M16 2.5v4M16 25.5v4M2.5 16h4M25.5 16h4M6.4 6.4l2.8 2.8m13.6 13.6 2.8 2.8m0-19.2-2.8 2.8M9.2 22.8l-2.8 2.8"/></>}
    {period === 'afternoon' && <><path d="M6 20a10 10 0 0 1 20 0"/><path d="M4 23h24M9 27h14M16 3v4M6.3 9.3l2.5 2.5m14.9-2.5-2.5 2.5"/></>}
    {period === 'evening' && <><path d="M24.5 20.5A11 11 0 0 1 11.5 7.2 11.5 11.5 0 1 0 24.5 20.5Z"/><path d="m22 5 .7 2.3L25 8l-2.3.7L22 11l-.7-2.3L19 8l2.3-.7L22 5Z"/></>}
    {period === 'late' && <><path d="m16 3 2.4 8.6L27 14l-8.6 2.4L16 25l-2.4-8.6L5 14l8.6-2.4L16 3Z"/><path d="m25 22 .8 2.2L28 25l-2.2.8L25 28l-.8-2.2L22 25l2.2-.8L25 22Z"/></>}
  </svg></span>;
}

function tenantDate(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftDate(day: string, delta: number) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0, 10); }
function weekdayFor(day: string) { return new Date(`${day}T00:00:00Z`).getUTCDay(); }
function zonedStart(day: string, timezone: string) {
  const [year, month, date] = day.split('-').map(Number); const desired = Date.UTC(year, month - 1, date); let instant = desired;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 4; attempt += 1) { const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value])); const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)); const delta = desired - represented; if (!delta) break; instant += delta; }
  return new Date(instant).toISOString();
}
function formatOpeningTime(value: string) {
  const [rawHour, minute] = value.slice(0, 5).split(':');
  const hour = Number(rawHour);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}${minute === '00' ? '' : `:${minute}`} ${suffix}`;
}

type BookingChartMode = 'week' | 'month' | 'custom';

function bookingChartRange(mode: BookingChartMode, today: string, customFrom: string, customTo: string) {
  if (mode === 'custom') return { from: customFrom, to: customTo };
  if (mode === 'week') {
    const monday = shiftDate(today, -((weekdayFor(today) + 6) % 7));
    return { from: monday, to: shiftDate(monday, 6) };
  }
  const monthStart = `${today.slice(0, 7)}-01`;
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from: monthStart, to: monthEnd };
}

type SharedChartRange = {
  mode: BookingChartMode;
  setMode: Dispatch<SetStateAction<BookingChartMode>>;
  customFrom: string;
  setCustomFrom: Dispatch<SetStateAction<string>>;
  customTo: string;
  setCustomTo: Dispatch<SetStateAction<string>>;
};

function OverviewChartRangeControls({ today, rangeState }: { today: string; rangeState: SharedChartRange }) {
  const { mode, setMode, customFrom, setCustomFrom, customTo, setCustomTo } = rangeState;
  const range = bookingChartRange(mode, today, customFrom || shiftDate(today, -6), customTo || today);
  const dateLabel = (date: string) => formatWorkspaceDate(date);
  const validRange = Boolean(range.from && range.to && range.from <= range.to);
  return <div className="owner-overview-range-controls">
    <div className="owner-overview-range-copy"><strong>Khoảng thời gian</strong><span>Áp dụng cho cả 3 biểu đồ</span></div>
    <div className="owner-trend-toolbar">
      <span className="owner-trend-period">{validRange ? `${dateLabel(range.from)} – ${dateLabel(range.to)}` : 'Khoảng ngày chưa hợp lệ'}</span>
      <div className="owner-calendar-view-switch" role="group" aria-label="Khoảng thời gian áp dụng cho cả ba biểu đồ">
        <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Tuần</button>
        <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Tháng</button>
        <button type="button" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>Tùy chỉnh</button>
      </div>
      {mode === 'custom' && <div className="owner-trend-date-range">
        <label><span>Từ</span><input type="date" aria-label="Từ ngày, áp dụng cho cả 3 biểu đồ" value={customFrom || shiftDate(today, -6)} onChange={(event) => setCustomFrom(event.target.value)}/></label>
        <label><span>Đến</span><input type="date" aria-label="Đến ngày, áp dụng cho cả 3 biểu đồ" value={customTo || today} onChange={(event) => setCustomTo(event.target.value)}/></label>
      </div>}
    </div>
  </div>;
}

function BookingTrendChart({ tenantId, today, rangeState }: { tenantId: string; today: string; rangeState: SharedChartRange }) {
  const { mode, customFrom, customTo } = rangeState;
  const [rows, setRows] = useState<BookingCountPointDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const range = bookingChartRange(mode, today, customFrom || shiftDate(today, -6), customTo || today);
  const dayCount = range.from && range.to
    ? Math.floor((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1
    : 0;
  const validRange = Boolean(range.from && range.to && range.from <= range.to && dayCount <= 366);

  useEffect(() => {
    let active = true;
    if (!validRange) {
      setRows([]); setLoading(false); setError('Chọn khoảng ngày hợp lệ, tối đa 366 ngày.');
      return () => { active = false; };
    }
    setRows([]); setLoading(true); setError('');
    void api.bookingCounts(tenantId, range.from, range.to)
      .then((result) => { if (active) setRows(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được số liệu lịch đặt.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, range.from, range.to, validRange]);

  const countByDay = new Map(rows.map((row) => [row.date, row.count]));
  const points = validRange
    ? Array.from({ length: dayCount }, (_, index) => {
      const date = shiftDate(range.from, index);
      return { date, count: countByDay.get(date) ?? 0 };
    })
    : [];
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const average = points.length ? total / points.length : 0;
  const chartWidth = 760; const chartHeight = 380;
  const margin = { top: 20, right: 18, bottom: 48, left: 48 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  const topValue = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const plotted = points.map((point, index) => ({
    ...point,
    x: margin.left + (points.length <= 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1)),
    y: margin.top + plotHeight - point.count / topValue * plotHeight,
  }));
  const segmentSlopes = plotted.slice(0, -1).map((point, index) =>
    (plotted[index + 1].y - point.y) / (plotted[index + 1].x - point.x));
  const tangents = plotted.map((_, index) => {
    if (segmentSlopes.length < 2) return segmentSlopes[0] ?? 0;
    if (index === 0) return segmentSlopes[0];
    if (index === plotted.length - 1) return segmentSlopes[segmentSlopes.length - 1];
    const before = segmentSlopes[index - 1];
    const after = segmentSlopes[index];
    if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0;
    return (2 * before * after) / (before + after);
  });
  const linePath = plotted.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    const previous = plotted[index - 1];
    const width = point.x - previous.x;
    const control1X = previous.x + width / 3;
    const control1Y = previous.y + tangents[index - 1] * width / 3;
    const control2X = point.x - width / 3;
    const control2Y = point.y - tangents[index] * width / 3;
    return `${path} C ${control1X.toFixed(2)} ${control1Y.toFixed(2)}, ${control2X.toFixed(2)} ${control2Y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, '');
  const areaPath = plotted.length
    ? `${linePath} L ${plotted[plotted.length - 1].x.toFixed(2)} ${(margin.top + plotHeight).toFixed(2)} L ${plotted[0].x.toFixed(2)} ${(margin.top + plotHeight).toFixed(2)} Z`
    : '';
  const labelIndexes = points.length <= 6
    ? points.map((_, index) => index)
    : Array.from(new Set([0, Math.round((points.length - 1) / 4), Math.round((points.length - 1) / 2), Math.round((points.length - 1) * 3 / 4), points.length - 1]));
  const dateLabel = (date: string) => formatWorkspaceDate(date, { year: false });

  return <section className="owner-panel owner-booking-trend" aria-labelledby="owner-booking-trend-title">
    <div className="owner-panel-heading owner-booking-trend-heading">
      <div><p className="owner-kicker">THEO DÕI LỊCH ĐẶT</p><h2 id="owner-booking-trend-title">Lượt đặt theo ngày</h2></div>
      <div className="owner-trend-summary"><strong>{total.toLocaleString('vi-VN')}</strong><span>Tổng lượt đặt</span><small>Trung bình {average.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} lượt/ngày</small></div>
    </div>
    {loading ? <p className="owner-trend-message" role="status">Đang tải biểu đồ…</p> : error ? <p className="owner-trend-message is-error" role="alert">{error}</p> : points.length === 0 ? <p className="owner-trend-message">Chưa có ngày nào trong khoảng đã chọn.</p> : <>
      <div className="owner-trend-chart-key" aria-label="Chú giải biểu đồ"><span><i className="is-daily"/>Lượt đặt mỗi ngày</span></div>
      <div className="owner-trend-chart-wrap">
        <svg className="owner-trend-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Biểu đồ đường có ${total} lượt đặt từ ${dateLabel(range.from)} đến ${dateLabel(range.to)}`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (bounds.width <= 0) { setHoveredIndex(null); return; }
            const chartX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
            if (chartX < margin.left || chartX > chartWidth - margin.right) { setHoveredIndex(null); return; }
            const nearest = plotted.length <= 1 ? 0 : Math.round(((chartX - margin.left) / plotWidth) * (plotted.length - 1));
            setHoveredIndex(Math.max(0, Math.min(plotted.length - 1, nearest)));
          }}
          onPointerLeave={() => setHoveredIndex(null)}>
          <defs><linearGradient id="owner-trend-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".24"/><stop offset="100%" stopColor="var(--accent)" stopOpacity=".015"/></linearGradient></defs>
          {[0, 1, 2, 3, 4].map((step) => {
            const value = topValue * (4 - step) / 4;
            const y = margin.top + step * plotHeight / 4;
            return <g key={step}><line x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} className="owner-trend-gridline"/><text x={margin.left - 10} y={y + 4} textAnchor="end" className="owner-trend-axis-label">{Math.round(value)}</text></g>;
          })}
          {areaPath && <path d={areaPath} className="owner-trend-area"/>}
          {hoveredIndex !== null && plotted[hoveredIndex] && <line x1={plotted[hoveredIndex].x} x2={plotted[hoveredIndex].x} y1={margin.top} y2={margin.top + plotHeight} className="owner-trend-hover-guide"/>}
          {linePath && <path d={linePath} className="owner-trend-line"/>}
          {labelIndexes.map((index) => <text key={points[index].date} x={plotted[index].x} y={chartHeight - 8} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="owner-trend-axis-label">{dateLabel(points[index].date)}</text>)}
        </svg>
        {hoveredIndex !== null && plotted[hoveredIndex] && <div className={`owner-trend-popover${hoveredIndex === 0 ? ' is-start' : hoveredIndex === plotted.length - 1 ? ' is-end' : ''}`} style={{ left: `${plotted[hoveredIndex].x / chartWidth * 100}%`, top: `${plotted[hoveredIndex].y / chartHeight * 100}%` }} role="status" aria-live="polite">
          <strong>{dateLabel(plotted[hoveredIndex].date)}</strong><span>{plotted[hoveredIndex].count.toLocaleString('vi-VN')} lịch đặt</span>
        </div>}
      </div>
    </>}
  </section>;
}

const SERVICE_CHART_COLORS = ['#667DD8', '#E8A8C8', '#879A8B', '#E2B45B', '#7E8D9C', '#42A895'];

function ServiceMixChart({ tenantId, today, rangeState }: { tenantId: string; today: string; rangeState: SharedChartRange }) {
  const [rows, setRows] = useState<ServiceBookingCountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoveredServiceIndex, setHoveredServiceIndex] = useState<number | null>(null);
  const range = bookingChartRange(rangeState.mode, today, rangeState.customFrom || shiftDate(today, -6), rangeState.customTo || today);
  const fromTime = Date.parse(`${range.from}T00:00:00Z`);
  const toTime = Date.parse(`${range.to}T00:00:00Z`);
  const dayCount = Math.floor((toTime - fromTime) / 86_400_000) + 1;
  const validRange = Boolean(range.from && range.to && range.from <= range.to && dayCount <= 366);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (!validRange) { setRows([]); setLoading(false); setError('Khoảng ngày không hợp lệ (tối đa 366 ngày).'); return () => { active = false; }; }
    void api.serviceBookingCounts(tenantId, range.from, range.to)
      .then((result) => { if (active) setRows(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được tỷ lệ dịch vụ.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, range.from, range.to, validRange]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const topRows = rows.slice(0, 5);
  const restCount = rows.slice(5).reduce((sum, row) => sum + row.count, 0);
  const chartRows = restCount ? [...topRows, { serviceId: 'other', serviceName: 'Dịch vụ khác', count: restCount }] : topRows;
  const circumference = 2 * Math.PI * 42;
  const hoveredService = hoveredServiceIndex === null ? null : chartRows[hoveredServiceIndex];
  const serviceTooltipPoint = hoveredServiceIndex === null ? null : (() => {
    const precedingCount = chartRows.slice(0, hoveredServiceIndex).reduce((sum, row) => sum + row.count, 0);
    const row = chartRows[hoveredServiceIndex];
    if (!row) return null;
    const middleAngle = -Math.PI / 2 + ((precedingCount + row.count / 2) / total) * Math.PI * 2;
    return { x: 56 + Math.cos(middleAngle) * 42, y: 56 + Math.sin(middleAngle) * 42, side: Math.cos(middleAngle) < 0 ? 'left' : 'right' };
  })();
  let offset = 0;
  const dateLabel = (date: string) => formatWorkspaceDate(date, { year: false });

  return <section className="owner-panel owner-service-mix" aria-labelledby="owner-service-mix-title">
    <div className="owner-panel-heading owner-service-mix-heading">
      <div><p className="owner-kicker">CƠ CẤU LỊCH ĐẶT</p><h2 id="owner-service-mix-title">Lượt đặt theo dịch vụ</h2></div>
      <span className="owner-service-mix-total"><strong>{total}</strong><small>lượt đặt</small></span>
    </div>
    {loading ? <p className="owner-trend-message" role="status">Đang tải cơ cấu dịch vụ…</p> : error ? <p className="owner-trend-message is-error" role="alert">{error}</p> : total === 0 ? <p className="owner-trend-message">Không có lượt đặt trong khoảng ngày này.</p> : <div className="owner-service-mix-content">
      <div className="owner-service-donut-wrap"><svg className="owner-service-donut" viewBox="0 0 112 112" role="img" aria-label={`Tỷ lệ ${chartRows.length} nhóm dịch vụ trong tổng số ${total} lượt đặt`}>
        <circle className="owner-service-donut-track" cx="56" cy="56" r="42" />
        {chartRows.map((row, index) => {
          const segment = row.count / total * circumference;
          const currentOffset = offset;
          offset += segment;
          const color = SERVICE_CHART_COLORS[index % SERVICE_CHART_COLORS.length];
          return <circle key={row.serviceId} className={`owner-service-donut-segment${hoveredServiceIndex === index ? ' is-hovered' : ''}`} cx="56" cy="56" r="42" fill="none" stroke={color} strokeWidth="16" strokeDasharray={`${segment} ${circumference - segment}`} strokeDashoffset={-currentOffset} transform="rotate(-90 56 56)" tabIndex={0} role="img" aria-label={`${row.serviceName}: ${row.count} lượt, ${Math.round(row.count / total * 100)} phần trăm`} onPointerEnter={() => setHoveredServiceIndex(index)} onPointerLeave={() => setHoveredServiceIndex(null)} onFocus={() => setHoveredServiceIndex(index)} onBlur={() => setHoveredServiceIndex(null)}/>;
        })}
        <text x="56" y="53" textAnchor="middle" className="owner-service-donut-total">{total}</text><text x="56" y="67" textAnchor="middle" className="owner-service-donut-caption">lượt đặt</text>
      </svg>
      {hoveredService && serviceTooltipPoint && <div className={`owner-service-donut-popover is-${serviceTooltipPoint.side}`} style={{ left: `${serviceTooltipPoint.x / 112 * 100}%`, top: `${serviceTooltipPoint.y / 112 * 100}%` }} role="status" aria-live="polite">
        <strong>{hoveredService.serviceName}</strong><span>{hoveredService.count.toLocaleString('vi-VN')} lượt · {Math.round(hoveredService.count / total * 100)}%</span>
      </div>}
      </div>
      <ul className="owner-service-mix-legend">{chartRows.map((row, index) => <li key={row.serviceId}><i style={{ background: SERVICE_CHART_COLORS[index % SERVICE_CHART_COLORS.length] }}/><span title={row.serviceName}>{row.serviceName}</span><strong>{row.count}</strong><small>({Math.round(row.count / total * 100)}%)</small></li>)}</ul>
    </div>}
  </section>;
}

function BookingRevenueChart({ tenantId, today, rangeState }: { tenantId: string; today: string; rangeState: SharedChartRange }) {
  const [rows, setRows] = useState<BookingRevenuePointDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const range = bookingChartRange(rangeState.mode, today, rangeState.customFrom || shiftDate(today, -6), rangeState.customTo || today);
  const fromTime = Date.parse(`${range.from}T00:00:00Z`);
  const toTime = Date.parse(`${range.to}T00:00:00Z`);
  const dayCount = Math.floor((toTime - fromTime) / 86_400_000) + 1;
  const validRange = Boolean(range.from && range.to && range.from <= range.to && dayCount <= 366);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (!validRange) { setRows([]); setLoading(false); setError('Khoảng ngày không hợp lệ (tối đa 366 ngày).'); return () => { active = false; }; }
    void api.bookingRevenue(tenantId, range.from, range.to)
      .then((result) => { if (active) setRows(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu doanh thu.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, range.from, range.to, validRange]);

  const bucketDays = dayCount > 180 ? 30 : dayCount > 45 ? 7 : 1;
  const amountsByDate = new Map(rows.map((row) => [row.date, row]));
  const points: Array<{ date: string; through: string; amountMinor: number; bookingCount: number }> = [];
  if (validRange) {
    for (let offset = 0; offset < dayCount; offset += bucketDays) {
      const date = shiftDate(range.from, offset);
      const through = shiftDate(range.from, Math.min(dayCount - 1, offset + bucketDays - 1));
      const bucket: typeof points[number] = { date, through, amountMinor: 0, bookingCount: 0 };
      for (let dayOffset = offset; dayOffset < Math.min(dayCount, offset + bucketDays); dayOffset += 1) {
        const row = amountsByDate.get(shiftDate(range.from, dayOffset));
        if (row) { bucket.amountMinor += row.amountMinor; bucket.bookingCount += row.bookingCount; }
      }
      points.push(bucket);
    }
  }
  const total = points.reduce((sum, point) => sum + point.amountMinor, 0);
  const bookingCount = points.reduce((sum, point) => sum + point.bookingCount, 0);
  const chartWidth = 900; const chartHeight = 450;
  const margin = { top: 22, right: 18, bottom: 48, left: 72 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const topValue = Math.max(4, Math.ceil(Math.max(0, ...points.map((point) => point.amountMinor)) / 4));
  const tickValue = topValue;
  const maxValue = tickValue * 4;
  const slotWidth = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(2, Math.min(32, slotWidth * .58));
  const plotted = points.map((point, index) => ({
    ...point,
    x: margin.left + index * slotWidth + (slotWidth - barWidth) / 2,
    y: margin.top + plotHeight - (point.amountMinor / maxValue) * plotHeight,
    height: (point.amountMinor / maxValue) * plotHeight,
  }));
  const dateLabel = (date: string) => formatWorkspaceDate(date, { year: false });
  const money = (value: number) => `${Math.round(value).toLocaleString('vi-VN')} ₫`;
  const compactMoney = (value: number) => `${new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ₫`;
  const labelIndexes = points.length <= 7 ? points.map((_, index) => index) : Array.from(new Set([0, Math.round((points.length - 1) / 4), Math.round((points.length - 1) / 2), Math.round((points.length - 1) * 3 / 4), points.length - 1]));
  const hovered = hoveredIndex === null ? null : plotted[hoveredIndex];

  return <section className="owner-panel owner-revenue-chart" aria-labelledby="owner-revenue-chart-title">
    <div className="owner-panel-heading owner-revenue-chart-heading">
      <div><p className="owner-kicker">GIÁ TRỊ LỊCH ĐẶT</p><h2 id="owner-revenue-chart-title">Doanh thu dự kiến</h2></div>
      <div className="owner-revenue-summary"><strong>{money(total)}</strong><span>{bookingCount.toLocaleString('vi-VN')} lịch được tính</span></div>
    </div>
    {loading ? <p className="owner-trend-message" role="status">Đang tải biểu đồ doanh thu.</p> : error ? <p className="owner-trend-message is-error" role="alert">{error}</p> : points.length === 0 ? <p className="owner-trend-message">Chưa có dữ liệu trong khoảng ngày đã chọn.</p> : <>
      <div className="owner-revenue-chart-key"><span><i/>Giá trị theo ngày{bucketDays === 7 ? ' / tuần' : bucketDays === 30 ? ' / khoảng 30 ngày' : ''}</span><small>{dateLabel(range.from)} – {dateLabel(range.to)}</small></div>
      <div className="owner-revenue-chart-wrap">
        <svg className="owner-revenue-chart-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Biểu đồ cột doanh thu dự kiến ${money(total)} trong khoảng ${dateLabel(range.from)} đến ${dateLabel(range.to)}`} onPointerLeave={() => setHoveredIndex(null)}>
          {[0, 1, 2, 3, 4].map((step) => {
            const value = maxValue * (4 - step) / 4;
            const y = margin.top + step * plotHeight / 4;
            return <g key={step}><line x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} className="owner-revenue-gridline"/><text x={margin.left - 10} y={y + 4} textAnchor="end" className="owner-trend-axis-label">{compactMoney(value)}</text></g>;
          })}
          {plotted.map((point, index) => <rect key={`hit-${point.date}`} x={margin.left + index * slotWidth} y={margin.top} width={slotWidth} height={plotHeight} className="owner-revenue-hit-area" tabIndex={0} role="img" aria-label={`${dateLabel(point.date)}${point.date !== point.through ? ` đến ${dateLabel(point.through)}` : ''}: ${money(point.amountMinor)}, ${point.bookingCount} lịch`} onPointerEnter={() => setHoveredIndex(index)} onFocus={() => setHoveredIndex(index)} onBlur={() => setHoveredIndex(null)} onKeyDown={(event) => { if (event.key === 'ArrowRight') setHoveredIndex(Math.min(points.length - 1, index + 1)); if (event.key === 'ArrowLeft') setHoveredIndex(Math.max(0, index - 1)); }}/>) }
          {plotted.map((point, index) => <rect key={point.date} x={point.x} y={Math.min(point.y, margin.top + plotHeight - 1)} width={barWidth} height={Math.max(1, point.height)} rx={Math.min(5, barWidth / 2)} className={`owner-revenue-bar${hoveredIndex === index ? ' is-hovered' : ''}`} aria-hidden="true"/>) }
          {labelIndexes.map((index) => <text key={points[index].date} x={margin.left + index * slotWidth + slotWidth / 2} y={chartHeight - 8} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="owner-trend-axis-label">{dateLabel(points[index].date)}</text>)}
        </svg>
        {hovered && <div className={`owner-revenue-popover${hoveredIndex === 0 ? ' is-start' : hoveredIndex === plotted.length - 1 ? ' is-end' : ''}`} style={{ left: `${(hovered.x + barWidth / 2) / chartWidth * 100}%`, top: `${hovered.y / chartHeight * 100}%` }} role="status" aria-live="polite"><strong>{hovered.date === hovered.through ? dateLabel(hovered.date) : `${dateLabel(hovered.date)} – ${dateLabel(hovered.through)}`}</strong><span>{money(hovered.amountMinor)}</span><small>{hovered.bookingCount.toLocaleString('vi-VN')} lịch đã xác nhận/hoàn tất</small></div>}
      </div>
    </>}
  </section>;
}

export default function WorkspacePage() {
  const notificationControl = useContext(WorkspaceNotificationControlContext);
  const router = useRouter();
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [businessHours, setBusinessHours] = useState<WorkingHourDto[]>([]);
  const [weekBookings, setWeekBookings] = useState<BookingDto[]>([]);
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekError, setWeekError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [chartMode, setChartMode] = useState<BookingChartMode>('month');
  const [customChartFrom, setCustomChartFrom] = useState('');
  const [customChartTo, setCustomChartTo] = useState('');

  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date());
    const timer = window.setInterval(updateTime, 60_000);
    document.addEventListener('visibilitychange', updateTime);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', updateTime); };
  }, []);

  const load = useCallback(async (tenantId: string) => {
    setLoading(true); setError('');
    try {
      const [tenant, hours] = await Promise.all([
        api.getCurrentTenant(tenantId), api.listBusinessHours(tenantId),
      ]);
      setContext(tenant);
      setBusinessHours(hours);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được tổng quan tiệm.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const tenantId = localStorage.getItem('sbc_tenant_id');
    if (!tenantId) { router.replace('/login'); return; }
    void load(tenantId);
    void api.getCurrentTenant(tenantId).then((tenant) => {
      const today = tenantDate(new Date(), tenant.location.timezone);
      const weekStart = shiftDate(today, -((weekdayFor(today) + 6) % 7));
      return api.listBookings(tenantId, zonedStart(weekStart, tenant.location.timezone), zonedStart(shiftDate(weekStart, 7), tenant.location.timezone));
    }).then(setWeekBookings).catch(() => setWeekError(true)).finally(() => setWeekLoading(false));
  }, [load, router]);

  if (loading) return <main className="owner-page"><p className="notice" role="status">Đang tải tổng quan…</p></main>;
  if (error || !context) return <main className="owner-page"><div className="notice notice-error" role="alert">{error || 'Không tải được tiệm.'}</div><button className="button button-secondary" onClick={() => { const id = localStorage.getItem('sbc_tenant_id'); if (id) void load(id); }}>Thử lại</button></main>;

  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: context.location.timezone, hour: '2-digit', hourCycle: 'h23' }).format(currentTime));
  const greeting = greetingFor(localHour, context.tenant.displayName);
  const today = tenantDate(currentTime, context.location.timezone);
  const chartRangeState: SharedChartRange = { mode: chartMode, setMode: setChartMode, customFrom: customChartFrom, setCustomFrom: setCustomChartFrom, customTo: customChartTo, setCustomTo: setCustomChartTo };
  const weekStart = shiftDate(today, -((weekdayFor(today) + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const weekdayLabels = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const bookingsByDay = new Map<string, BookingDto[]>();
  for (const booking of weekBookings) {
    const day = tenantDate(new Date(booking.startsAt), context.location.timezone);
    bookingsByDay.set(day, [...(bookingsByDay.get(day) ?? []), booking]);
  }
  return <main className="owner-page owner-overview">
    <header className="owner-page-heading owner-overview-heading"><div className="owner-greeting"><h1>{greeting.text}</h1><GreetingIcon period={greeting.period}/></div>{notificationControl}</header>
    <section className="owner-panel owner-week-panel"><div className="owner-panel-heading"><div><p className="owner-kicker">LỊCH TUẦN NÀY</p><h2>Giờ phục vụ & lịch hẹn</h2></div><Link href="/workspace/calendar?view=week">Mở lịch tuần →</Link></div>
      {weekLoading ? <p className="owner-empty" role="status">Đang tải lịch tuần…</p> : weekError ? <p className="owner-empty">Không tải được dữ liệu tuần này. Hãy mở phần Giờ làm để kiểm tra khung giờ tiệm.</p> : <div className="owner-week-scroll" tabIndex={0} aria-label="Lịch tuần, cuộn ngang để xem đủ bảy ngày"><div className="owner-week-grid">{weekDates.map((day) => {
        const weekday = weekdayFor(day); const hours = businessHours.filter((row) => row.weekday === weekday); const dayBookings = (bookingsByDay.get(day) ?? []).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
        return <article key={day} className={`owner-week-day${day === today ? ' is-today' : ''}`}>
          <header><div className="owner-week-day-title"><strong>{weekdayLabels[weekday]}</strong><span className={`owner-week-header-hours${hours.length ? '' : ' is-closed'}`}>{hours.length ? hours.map((row) => `${formatOpeningTime(row.localStart)}–${formatOpeningTime(row.localEnd)}`).join(' · ') : 'Đóng cửa'}</span></div><time className="owner-week-date">{formatWorkspaceDate(day, { year: false })}</time></header>
          <div className="owner-week-count">{dayBookings.length} lịch · {new Set(dayBookings.map((booking) => booking.staffId)).size} nhân viên</div>
          <div className="owner-week-bookings">{dayBookings.length > 0 && <>{dayBookings.slice(0, 2).map((booking) => <span key={booking.id}><time>{new Intl.DateTimeFormat('en-US', { timeZone: context.location.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(booking.startsAt))}</time><span className="owner-week-booking-service" title={booking.serviceSnapshot.name}>{booking.serviceSnapshot.name}</span></span>)}{dayBookings.length > 2 && <small>+{dayBookings.length - 2} lịch khác</small>}</>}</div>
          <Link href={`/workspace/calendar?view=day&date=${day}`} aria-label={`Mở lịch ngày ${formatWorkspaceDate(day)}`}>Chi tiết ngày →</Link>
        </article>;
      })}</div></div>}
    </section>
    <OverviewChartRangeControls today={today} rangeState={chartRangeState}/>
    <div className="owner-overview-grid">
      <BookingTrendChart tenantId={context.tenant.id} today={today} rangeState={chartRangeState}/>
      <ServiceMixChart tenantId={context.tenant.id} today={today} rangeState={chartRangeState}/>
      <BookingRevenueChart tenantId={context.tenant.id} today={today} rangeState={chartRangeState}/>
    </div>
  </main>;
}
