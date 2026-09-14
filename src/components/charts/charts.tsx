"use client";

import * as React from "react";
import { money, compactScale } from "@/lib/format";

/**
 * Dependency-free SVG charts.
 *
 * Chosen deliberately: they render on the server, animate with CSS, stay crisp
 * on every screen size and add no client bundle weight beyond this file. All
 * values come from the accounting engine — the charts only visualise them.
 */

export type SeriesPoint = { label: string; value: number };
export type Series = { key: string; name: string; color: string; points: SeriesPoint[]; type?: "area" | "line" | "bar" };

/**
 * Charts receive a serialisable format *description* rather than a function, so
 * a server component can render them without crossing the RSC boundary with a
 * callback. Formatting itself lives here and uses the shared `lib/format`
 * helpers, which keeps axis labels identical to the numbers in tables.
 */
export type ValueFormat =
  | { kind: "money"; currency: string; locale?: string; compact?: boolean; code?: boolean }
  | { kind: "number"; decimals?: number; locale?: string }
  | { kind: "percent"; decimals?: number };

/** Axis ticks are compact by design: 12.5M reads better than 12 500 000. */
function axisFormatFor(format?: ValueFormat): ValueFormat | undefined {
  if (!format) return undefined;
  if (format.kind === "money") return { ...format, compact: true };
  return format;
}

export function formatChartValue(value: number, format?: ValueFormat): string {
  if (!format) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  if (format.kind === "money") {
    const locale = format.locale === "ru" ? "ru" : "en";
    return money(value, format.currency, format.locale === "ru" ? "ru" : "en", {
      compact: format.compact,
      code: format.code ?? false,
      signed: false,
    }) || new Intl.NumberFormat(locale).format(value);
  }
  if (format.kind === "percent") return `${value.toFixed(format.decimals ?? 1)}%`;
  return new Intl.NumberFormat(format.locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: format.decimals ?? 0 }).format(value);
}

const DEFAULT_COLORS = {
  revenue: "#4338ca",
  expenses: "#f43f5e",
  profit: "#10b981",
  cash: "#0ea5e9",
  neutral: "#8d96b0",
};

function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(720);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && Math.abs(next - width) > 1) setWidth(next);
    });
    observer.observe(element);
    setWidth(element.clientWidth || 720);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, width];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(Math.abs(span) / count)));
  const candidates = [1, 2, 2.5, 5, 10].map((multiplier) => step * multiplier);
  const chosen = candidates.find((candidate) => span / candidate <= count) ?? step * 10;
  const start = Math.floor(min / chosen) * chosen;
  const end = Math.ceil(max / chosen) * chosen;
  const ticks: number[] = [];
  for (let value = start; value <= end + chosen / 2; value += chosen) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

export function LineChart({
  series,
  height = 260,
  format,
  showLegend = true,
  zeroLine = true,
}: {
  series: Series[];
  height?: number;
  format?: ValueFormat;
  showLegend?: boolean;
  zeroLine?: boolean;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);

  const padding = { top: 14, right: 16, bottom: 28, left: 52 };
  const innerWidth = Math.max(10, width - padding.left - padding.right);
  const innerHeight = Math.max(10, height - padding.top - padding.bottom);

  const allValues = series.flatMap((item) => item.points.map((point) => point.value));
  const min = Math.min(0, ...allValues);
  const max = Math.max(1, ...allValues);
  const ticks = niceTicks(min, max, 4);
  const scaleY = (value: number) => padding.top + innerHeight - ((value - ticks[0]) / (ticks[ticks.length - 1] - ticks[0] || 1)) * innerHeight;
  const labelCount = series[0]?.points.length ?? 0;
  const scaleX = (index: number) => padding.left + (labelCount <= 1 ? innerWidth / 2 : (index / (labelCount - 1)) * innerWidth);

  const axisFormat = (value: number) => formatChartValue(value, axisFormatFor(format));

  return (
    <div ref={ref} className="w-full">
      {showLegend ? (
        <div className="mb-3 flex flex-wrap items-center gap-4">
          {series.map((item) => (
            <span key={item.key} className="flex items-center gap-2 text-[12px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              {item.name}
            </span>
          ))}
        </div>
      ) : null}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" className="overflow-visible">
        <defs>
          {series.map((item) => (
            <linearGradient key={item.key} id={`grad-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="var(--border)"
              strokeDasharray={tick === 0 && zeroLine ? "0" : "3 5"}
              strokeWidth={tick === 0 && zeroLine ? 1 : 1}
            />
            <text x={padding.left - 8} y={scaleY(tick) + 4} textAnchor="end" className="fill-[color:var(--text-subtle)] text-[10.5px]">
              {axisFormat(tick)}
            </text>
          </g>
        ))}

        {series.map((item) => {
          if (item.type === "bar") {
            const barWidth = Math.max(6, innerWidth / Math.max(1, labelCount) / (series.length + 1));
            return (
              <g key={item.key}>
                {item.points.map((point, index) => {
                  const x = scaleX(index) - barWidth / 2;
                  const y = point.value >= 0 ? scaleY(point.value) : scaleY(0);
                  const barHeight = Math.abs(scaleY(0) - scaleY(point.value));
                  return (
                    <rect
                      key={`${item.key}-${point.label}`}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(1, barHeight)}
                      rx={4}
                      fill={item.color}
                      opacity={hover === null || hover === index ? 0.92 : 0.42}
                      style={{ transition: "opacity 0.18s ease" }}
                    />
                  );
                })}
              </g>
            );
          }

          const path = item.points.map((point, index) => `${index === 0 ? "M" : "L"}${scaleX(index)},${scaleY(point.value)}`).join(" ");
          const areaPath = `${path} L${scaleX(item.points.length - 1)},${scaleY(Math.max(0, ticks[0]))} L${scaleX(0)},${scaleY(Math.max(0, ticks[0]))} Z`;

          return (
            <g key={item.key}>
              {item.type !== "line" ? <path d={areaPath} fill={`url(#grad-${item.key})`} /> : null}
              <path
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeDasharray: 2000, strokeDashoffset: 0 }}
              />
              {item.points.map((point, index) => (
                <circle
                  key={`${item.key}-dot-${point.label}`}
                  cx={scaleX(index)}
                  cy={scaleY(point.value)}
                  r={hover === index ? 4.5 : 0}
                  fill="var(--surface)"
                  stroke={item.color}
                  strokeWidth={2}
                  style={{ transition: "r 0.15s ease" }}
                />
              ))}
            </g>
          );
        })}

        {series[0]?.points.map((point, index) => (
          <text
            key={`label-${point.label}`}
            x={scaleX(index)}
            y={height - 8}
            textAnchor="middle"
            className="fill-[color:var(--text-subtle)] text-[10.5px]"
          >
            {point.label}
          </text>
        ))}

        {series[0]?.points.map((_, index) => (
          <rect
            key={`hit-${index}`}
            x={scaleX(index) - innerWidth / Math.max(1, labelCount) / 2}
            y={padding.top}
            width={innerWidth / Math.max(1, labelCount)}
            height={innerHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hover !== null && series[0]?.points[hover] ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-[color:var(--border)] surface-muted px-3 py-2">
          <span className="text-[12px] font-medium">{series[0].points[hover].label}</span>
          {series.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
              {item.name}: <span className="num font-medium text-[color:var(--text)]">{formatChartValue(item.points[hover]?.value ?? 0, format)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BarChart({
  data,
  height = 220,
  format,
  color = DEFAULT_COLORS.revenue,
  compareColor = DEFAULT_COLORS.expenses,
  showCompare = false,
}: {
  data: { label: string; value: number; compare?: number }[];
  height?: number;
  format?: ValueFormat;
  color?: string;
  compareColor?: string;
  showCompare?: boolean;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const padding = { top: 12, right: 12, bottom: 26, left: 48 };
  const innerWidth = Math.max(10, width - padding.left - padding.right);
  const innerHeight = Math.max(10, height - padding.top - padding.bottom);
  const max = Math.max(1, ...data.map((row) => Math.max(row.value, showCompare ? (row.compare ?? 0) : 0)));
  const ticks = niceTicks(0, max, 3);
  const scaleY = (value: number) => padding.top + innerHeight - (value / (ticks[ticks.length - 1] || 1)) * innerHeight;
  const slot = innerWidth / Math.max(1, data.length);
  const barWidth = Math.max(8, Math.min(38, slot * (showCompare ? 0.28 : 0.5)));

  return (
    <div ref={ref} className="w-full">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={scaleY(tick)} y2={scaleY(tick)} stroke="var(--border)" strokeDasharray="3 5" />
            <text x={padding.left - 8} y={scaleY(tick) + 4} textAnchor="end" className="fill-[color:var(--text-subtle)] text-[10.5px]">
              {formatChartValue(tick, format)}
            </text>
          </g>
        ))}
        {data.map((row, index) => {
          const center = padding.left + slot * index + slot / 2;
          const height = Math.abs(scaleY(row.value) - scaleY(0));
          return (
            <g key={row.label} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
              <rect x={padding.left + slot * index} y={padding.top} width={slot} height={innerHeight} fill="transparent" />
              <rect
                x={showCompare ? center - barWidth - 2 : center - barWidth / 2}
                y={scaleY(row.value)}
                width={barWidth}
                height={Math.max(2, height)}
                rx={5}
                fill={color}
                opacity={hover === null || hover === index ? 0.94 : 0.5}
                style={{ transition: "opacity 0.18s ease" }}
              />
              {showCompare ? (
                <rect
                  x={center + 2}
                  y={scaleY(row.compare ?? 0)}
                  width={barWidth}
                  height={Math.max(2, Math.abs(scaleY(row.compare ?? 0) - scaleY(0)))}
                  rx={5}
                  fill={compareColor}
                  opacity={hover === null || hover === index ? 0.55 : 0.25}
                />
              ) : null}
              <text x={center} y={height - 8} textAnchor="middle" className="fill-[color:var(--text-subtle)] text-[10.5px]">
                {row.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] ? (
        <div className="mt-1 flex items-center gap-4 rounded-[10px] border border-[color:var(--border)] surface-muted px-3 py-2 text-[12px]">
          <span className="font-medium">{data[hover].label}</span>
          <span className="num text-muted">{formatChartValue(data[hover].value, format)}</span>
          {showCompare ? <span className="num text-subtle">vs {formatChartValue(data[hover].compare ?? 0, format)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function DonutChart({
  data,
  size = 190,
  thickness = 22,
  centerLabel,
  centerValue,
  format,
}: {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  format?: ValueFormat;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const palette = ["#4338ca", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#64748b", "#8b5cf6"];
  const total = data.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((row, index) => {
            const fraction = Math.max(0, row.value) / total;
            const dash = fraction * circumference;
            const element = (
              <circle
                key={row.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={row.color ?? palette[index % palette.length]}
                strokeWidth={hover === index ? thickness + 4 : thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                opacity={hover === null || hover === index ? 1 : 0.45}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                style={{ transition: "stroke-width 0.18s ease, opacity 0.18s ease" }}
              />
            );
            offset += dash;
            return element;
          })}
        </g>
        {centerValue ? (
          <g>
            <text x={size / 2} y={size / 2 - 2} textAnchor="middle" className="fill-[color:var(--text)] text-[15px] font-semibold">
              {centerValue}
            </text>
            {centerLabel ? (
              <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="fill-[color:var(--text-subtle)] text-[11px]">
                {centerLabel}
              </text>
            ) : null}
          </g>
        ) : null}
      </svg>
      <div className="w-full space-y-2">
        {data.map((row, index) => {
          const share = (Math.max(0, row.value) / total) * 100;
          return (
            <div
              key={row.label}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-1 transition-colors hover:surface-muted"
            >
              <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color ?? palette[index % palette.length] }} />
                <span className="truncate text-muted">{row.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[12.5px]">
                <span className="num font-medium">{formatChartValue(row.value, format)}</span>
                <span className="num w-10 text-right text-subtle">{share.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Sparkline({
  points,
  color = DEFAULT_COLORS.revenue,
  height = 36,
  width = 120,
}: {
  points: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (points.length < 2) return <div style={{ height }} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${(index / (points.length - 1)) * width},${height - ((value - min) / span) * (height - 6) - 3}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProgressRing({ value, size = 74, thickness = 7, label }: { value: number; size?: number; thickness?: number; label?: string }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;
  const color = clamped >= 80 ? "#10b981" : clamped >= 65 ? "#4338ca" : clamped >= 45 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[15px] font-semibold">{Math.round(clamped)}</span>
        {label ? <span className="text-[9.5px] text-subtle">{label}</span> : null}
      </div>
    </div>
  );
}

export const CHART_COLORS = DEFAULT_COLORS;
