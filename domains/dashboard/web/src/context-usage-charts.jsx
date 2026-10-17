import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRightOutlined } from '@ant-design/icons';
import { t, getDashboardLocale } from './dashboard-i18n.js';

function timedRequests(recent) {
  return recent
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.counted && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0)
    .sort((a, b) => Date.parse(a.row.occurredAt) - Date.parse(b.row.occurredAt));
}

export function UsageHitBreakdown({ snapshot }) {
  const known = snapshot?.available === true;
  const requests = known ? (snapshot.requests ?? 0) : 0;
  const hits = known ? (snapshot.hits ?? 0) : 0;
  return (
    <div className="usage-hit-breakdown">
      <div className="usage-hit-track" aria-hidden="true">
        <span style={{ width: `${requests ? (hits / requests) * 100 : 0}%` }} />
      </div>
      <div className="usage-chart-key">
        <span>
          <i />
          {t('适用请求')} <strong>{known ? hits : '—'}</strong>
        </span>
        <span>
          <i className="is-muted" />
          {t('无适用内容')} <strong>{known ? requests - hits : '—'}</strong>
        </span>
      </div>
    </div>
  );
}

export function UsageDeliveryChart({ snapshot }) {
  const known = snapshot?.available === true;
  const full = known ? (snapshot.fullDeliveries ?? 0) : 0;
  const summary = known ? Math.max(0, (snapshot.recommendations ?? 0) - full) : 0;
  const max = Math.max(1, full, summary);
  return (
    <div className="usage-delivery-chart" aria-label={t('全文与摘要交付')}>
      {[full, summary].map((value, index) => (
        <div key={index}>
          <div className="usage-delivery-track" aria-hidden="true">
            <span style={{ height: `${(value / max) * 100}%` }} />
          </div>
          <span>{index === 0 ? t('全文') : t('摘要')}</span>
          <strong>{known ? value : '—'}</strong>
        </div>
      ))}
    </div>
  );
}

export function UsageMiniLatency({ recent }) {
  const rows = timedRequests(recent);
  const canvasRef = useRef(null);
  const startedAt = useRef(null);
  const series = JSON.stringify(rows.map(({ row }) => row.elapsedMs));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const samples = JSON.parse(series);
    const maximum = Math.max(1, ...samples);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame;
    let previousFrame = -Infinity;
    const resize = () => {
      const size = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(size.width * ratio));
      canvas.height = Math.max(1, Math.round(size.height * ratio));
    };
    const draw = (timestamp) => {
      frame = window.requestAnimationFrame(draw);
      if (timestamp - previousFrame < 1000 / 30) return;
      previousFrame = timestamp;
      startedAt.current ??= timestamp;
      const phase = ((timestamp - startedAt.current) / 4200) * Math.PI * 2;
      const scale = Math.min(canvas.width / 120, canvas.height / 64);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(
        scale,
        0,
        0,
        scale,
        (canvas.width - scale * 120) / 2,
        (canvas.height - scale * 64) / 2,
      );
      const style = getComputedStyle(canvas);
      const accent = style.color;
      const lightness = style.getPropertyValue('--usage-braid-lightness').trim();
      const gradients = Array.from({ length: 3 }, (_, strand) => {
        const hue = 220 + Math.sin(phase / 4 + (strand * Math.PI * 2) / 3) * 38;
        const gradient = context.createLinearGradient(8, 0, 112, 0);
        gradient.addColorStop(0, `hsl(${hue} 72% ${lightness})`);
        gradient.addColorStop(0.5, accent);
        gradient.addColorStop(1, `hsl(${440 - hue} 72% ${lightness})`);
        return gradient;
      });
      const segments = [];
      for (let strand = 0; strand < 3; strand++) {
        let previous;
        for (let step = 0; step <= 72; step++) {
          const position = step / 72;
          const sample = position * (samples.length - 1);
          const index = Math.floor(sample);
          const t = sample - index;
          const [a, b, c, d] = [-1, 0, 1, 2].map(
            (offset) => samples[Math.max(0, Math.min(index + offset, samples.length - 1))],
          );
          const value = Math.max(
            0,
            Math.min(
              maximum,
              0.5 *
                (2 * b +
                  (c - a) * t +
                  (2 * a - 5 * b + 4 * c - d) * t * t +
                  (3 * b - a - 3 * c + d) * t * t * t),
            ),
          );
          const angle = position * Math.PI * 3.2 - phase + (strand * Math.PI * 2) / 3;
          const point = {
            x: 8 + position * 104,
            y: 54 - (value / maximum) * 40 + Math.sin(angle) * 8,
            z: Math.cos(angle),
          };
          if (previous)
            segments.push({ from: previous, to: point, z: (previous.z + point.z) / 2, strand });
          previous = point;
        }
      }
      context.lineCap = 'butt';
      // 从远到近绘制，让前景线遮住后景线，保留交织的空间感。
      for (const segment of segments.sort((a, b) => a.z - b.z)) {
        const depth = (segment.z + 1) / 2;
        const width = 0.8 + depth * 1.4;
        context.beginPath();
        context.moveTo(segment.from.x, segment.from.y);
        context.lineTo(segment.to.x, segment.to.y);
        context.globalAlpha = 0.22 + depth * 0.78;
        context.strokeStyle = gradients[segment.strand];
        context.lineWidth = width;
        context.stroke();
      }
    };
    const updateMotion = () => {
      window.cancelAnimationFrame(frame);
      previousFrame = -Infinity;
      if (!motion.matches) frame = window.requestAnimationFrame(draw);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener('change', updateMotion);
    updateMotion();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', updateMotion);
    };
  }, [series]);
  const max = Math.max(1, ...rows.map(({ row }) => row.elapsedMs));
  const points = rows.map(
    ({ row }, index) =>
      `${8 + (index / Math.max(1, rows.length - 1)) * 104},${54 - (row.elapsedMs / max) * 40}`,
  );
  return (
    <div className={`usage-mini-latency${rows.length > 1 ? ' has-braid' : ''}`} aria-hidden="true">
      <svg className="usage-mini-latency-static" viewBox="0 0 120 64">
        <path d="M 8 54 H 112" className="usage-chart-grid-line" />
        {rows.length > 1 && (
          <polyline points={points.join(' ')} pathLength="1" className="usage-chart-line" />
        )}
        {rows.map(({ row, index }, position) => (
          <circle
            key={index}
            cx={8 + (position / Math.max(1, rows.length - 1)) * 104}
            cy={54 - (row.elapsedMs / max) * 40}
            r="3"
            className="usage-chart-dot"
            style={{ '--usage-point-delay': `${100 + position * 55}ms` }}
          />
        ))}
      </svg>
      {rows.length > 1 && <canvas className="usage-mini-latency-braid" ref={canvasRef} />}
    </div>
  );
}

export function UsageLatencyChart({ recent, demo, onSelect, requestType = 'retrieval' }) {
  const commandMode = requestType === 'command';
  const ref = useRef(null);
  const patternId = `usage-stripes-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  const [width, setWidth] = useState(600);
  const [activeKey, setActiveKey] = useState(null);
  useEffect(() => {
    const element = ref.current;
    const update = () => setWidth(Math.max(180, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rows = timedRequests(recent);
  const ceiling = Math.max(
    20,
    Math.ceil((Math.max(0, ...rows.map(({ row }) => row.elapsedMs)) * 1.1) / 20) * 20,
  );
  const left = 38;
  const right = width - 14;
  const top = 24;
  const bottom = 196;
  const firstTime = rows.length ? Date.parse(rows[0].row.occurredAt) : 0;
  const lastTime = rows.length ? Date.parse(rows.at(-1).row.occurredAt) : 0;
  const duration = lastTime - firstTime;
  const points = rows.map((entry, index) => ({
    ...entry,
    x:
      rows.length === 1
        ? (left + right) / 2
        : left +
          (duration > 0
            ? (Date.parse(entry.row.occurredAt) - firstTime) / duration
            : index / (rows.length - 1)) *
            (right - left),
    y: bottom - (entry.row.elapsedMs / ceiling) * (bottom - top),
  }));
  const active = points.find((point) => point.row.episodeId === activeKey) ?? points.at(-1);
  const line = points.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area =
    points.length > 1 ? `${line} L ${points.at(-1).x} ${bottom} L ${points[0].x} ${bottom} Z` : '';
  const spansDays =
    new Set(rows.map(({ row }) => new Date(row.occurredAt).toDateString())).size > 1;
  const tickCount = rows.length > 1 && duration > 0 ? (width < 480 ? 3 : 5) : 1;
  const ticks = Array.from({ length: tickCount }, (_, index) => ({
    x: tickCount === 1 ? (left + right) / 2 : left + (index / (tickCount - 1)) * (right - left),
    time: tickCount === 1 ? firstTime : firstTime + (index / (tickCount - 1)) * duration,
  }));
  return (
    <div className="usage-latency-plot">
      <div ref={ref}>
        {rows.length ? (
          <>
            <svg
              width="100%"
              height="230"
              role="group"
              aria-label={t(commandMode ? '最近命令耗时曲线' : '最近请求耗时曲线')}
            >
              <defs>
                <pattern
                  id={patternId}
                  width="9"
                  height="9"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(25)"
                >
                  <rect width="9" height="9" fill="var(--color-accent-softer)" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="9"
                    stroke="var(--color-accent)"
                    strokeOpacity="0.17"
                    strokeWidth="3"
                  />
                </pattern>
              </defs>
              {[0, 1, 2, 3, 4].map((tick) => {
                const y = bottom - (tick / 4) * (bottom - top);
                return (
                  <g key={tick}>
                    <line x1={left} x2={right} y1={y} y2={y} className="usage-chart-grid-line" />
                    <text x={left - 9} y={y + 4} textAnchor="end" className="usage-chart-axis">
                      {(ceiling * tick) / 4}
                    </text>
                  </g>
                );
              })}
              <text x={left - 9} y="12" textAnchor="end" className="usage-chart-axis">
                ms
              </text>
              {area && <path d={area} fill={`url(#${patternId})`} className="usage-chart-area" />}
              {points.length > 1 && <path d={line} pathLength="1" className="usage-chart-line" />}
              {active && (
                <line
                  x1="0"
                  x2="0"
                  y1={active.y}
                  y2={bottom}
                  className="usage-chart-highlight"
                  style={{ transform: `translateX(${active.x}px)` }}
                />
              )}
              {points.map(({ row, index, x, y }, position) => (
                <g
                  key={`${row.episodeId}:${index}`}
                  role="button"
                  tabIndex={0}
                  aria-label={t(
                    commandMode ? '查看运行记录：{0}，{1} ms' : '查看检索请求：{0}，{1} ms',
                    [demo ? t(row.task) : row.task, Math.round(row.elapsedMs)],
                  )}
                  onMouseEnter={() => setActiveKey(row.episodeId)}
                  onFocus={() => setActiveKey(row.episodeId)}
                  onClick={() => onSelect(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(index);
                    }
                  }}
                >
                  <circle cx={x} cy={y} r="14" fill="transparent" />
                  <circle
                    cx={x}
                    cy={y}
                    r={row.episodeId === active?.row.episodeId ? 5 : 3.5}
                    className="usage-chart-dot"
                    style={{ '--usage-point-delay': `${120 + position * 60}ms` }}
                  />
                </g>
              ))}
              {ticks.map(({ x, time }, index) => (
                <text
                  key={index}
                  x={x}
                  y={bottom + 24}
                  textAnchor={
                    tickCount === 1
                      ? 'middle'
                      : index === 0
                        ? 'start'
                        : index === tickCount - 1
                          ? 'end'
                          : 'middle'
                  }
                  className="usage-chart-axis"
                >
                  {new Date(time).toLocaleString(getDashboardLocale(), {
                    ...(spansDays ? { month: '2-digit', day: '2-digit' } : {}),
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </text>
              ))}
              {active && (
                <g
                  style={{
                    transform: `translate(${Math.max(left, Math.min(right - 66, active.x - 33))}px, ${Math.max(4, active.y - 36)}px)`,
                  }}
                  className="usage-chart-value"
                >
                  <rect width="66" height="24" rx="6" />
                  <text x="33" y="16" textAnchor="middle">
                    {Math.round(active.row.elapsedMs)} ms
                  </text>
                </g>
              )}
            </svg>
            <button
              className="usage-latency-selection"
              aria-label={t(commandMode ? '查看当前运行记录' : '查看当前图表请求')}
              onClick={() => onSelect(active.index)}
            >
              <span>{demo ? t(active.row.task) : active.row.task}</span>
              <time dateTime={active.row.occurredAt}>
                {new Date(active.row.occurredAt).toLocaleString(getDashboardLocale(), {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              <ArrowRightOutlined />
            </button>
          </>
        ) : (
          <div className="usage-chart-empty">{t('尚无耗时记录')}</div>
        )}
      </div>
      <p className="usage-chart-caption">
        {t(
          commandMode
            ? '仅展示最近 {0} 条命令记录，按时间排序。'
            : '仅展示最近 {0} 条有耗时记录的检索请求，按时间排序。',
          [rows.length],
        )}
      </p>
    </div>
  );
}

export function UsageFeedbackChart({ snapshot, children }) {
  const known = snapshot?.available === true;
  const success = known && snapshot.successRate != null ? snapshot.successRate * 100 : 0;
  const coverage = known && snapshot.feedbackRate != null ? snapshot.feedbackRate * 100 : 0;
  return (
    <div className="usage-feedback-chart">
      <div className="usage-feedback-gauge">
        <svg viewBox="0 0 240 142" aria-hidden="true">
          <path d="M 24 124 A 96 96 0 0 1 216 124" className="usage-gauge-track" />
          <path d="M 44 124 A 76 76 0 0 1 196 124" className="usage-gauge-track" />
          {success > 0 && (
            <path
              d="M 24 124 A 96 96 0 0 1 216 124"
              pathLength="100"
              strokeDasharray="100 100"
              strokeDashoffset={100 - success}
              className="usage-gauge-success"
            />
          )}
          {coverage > 0 && (
            <path
              d="M 44 124 A 76 76 0 0 1 196 124"
              pathLength="100"
              strokeDasharray="100 100"
              strokeDashoffset={100 - coverage}
              className="usage-gauge-coverage"
            />
          )}
        </svg>
        <div className="usage-gauge-number">
          <strong>
            {known ? (snapshot.feedbackCount ?? 0) : '—'}
            <small> / {known ? (snapshot.recommendations ?? 0) : '—'}</small>
          </strong>
          <span>{t('推荐已有结果反馈')}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

export function UsageOutcomeChart({ snapshot }) {
  const known = snapshot?.available === true;
  const outcomes = [
    [t('成功使用'), 'successes', 'var(--color-accent)'],
    [t('已纠正'), 'corrections', 'var(--color-warn)'],
    [t('导致失败'), 'failures', 'var(--color-danger)'],
    [t('未采用'), 'ignored', 'var(--color-muted)'],
    [t('已覆盖'), 'overridden', 'var(--color-border)'],
  ];
  const total = known ? outcomes.reduce((sum, [, key]) => sum + (snapshot[key] ?? 0), 0) : 0;
  return (
    <div className="usage-outcome-chart" aria-label={t('反馈结果分布')}>
      {outcomes.map(([label, key, color]) => (
        <div key={key}>
          <span>{label}</span>
          <div className="usage-outcome-track" aria-hidden="true">
            <span
              style={{
                width: `${total ? ((snapshot[key] ?? 0) / total) * 100 : 0}%`,
                background: color,
              }}
            />
          </div>
          <strong>{known ? (snapshot[key] ?? 0) : '—'}</strong>
        </div>
      ))}
      <p className="usage-chart-caption">
        {total ? t('仅统计已收到的使用反馈') : t('尚无使用反馈')}
      </p>
    </div>
  );
}
