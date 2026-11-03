"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

export type SeriesColor = "series-1" | "series-2" | "series-3";

export type ChartSeries = {
  id: string;
  label: string;
  color: SeriesColor;
  values: number[];
};

/** How values are formatted. Currency values are minor units. */
export type ValueFormat = { kind: "currency"; currency: string } | { kind: "number" } | { kind: "roas" };

const COLOR_VAR: Record<SeriesColor, string> = {
  "series-1": "var(--series-1)",
  "series-2": "var(--series-2)",
  "series-3": "var(--series-3)",
};


function niceScale(maxValue: number, intervals = 4) {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
  const raw = maxValue / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const n = raw / magnitude;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * magnitude;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max, ticks };
}

function xLabelIndices(count: number): number[] {
  if (count <= 8) return Array.from({ length: count }, (_, i) => i);
  const slots = 5;
  return Array.from({ length: slots + 1 }, (_, i) => Math.round((i * (count - 1)) / slots));
}

/**
 * Time-series chart (line or column) with a crosshair tooltip.
 * - One y-axis only; values of different units belong in separate charts.
 * - Legend for 2+ series; a single series is named by the card title.
 * - Mouse: hover. Touch: tap or drag sideways to scrub (vertical drags still
 *   scroll the page); the readout stays until you tap outside the chart.
 * - Keyboard: focus the plot, then use ←/→ (Home/End) to move the readout.
 * - Height adapts to the screen; a data table is always available below.
 */
export function TimeSeriesChart({
  title,
  dates,
  series,
  format,
  mark = "line",
  reference,
}: {
  title: string;
  dates: string[];
  series: ChartSeries[];
  format: ValueFormat;
  mark?: "line" | "column";
  reference?: { value: number; label: string };
}) {
  const { fmt, dict, dir } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  const figureRef = useRef<HTMLElement>(null);
  // True while a touch/pen readout is pinned (it has no hover to end it).
  const [pinned, setPinned] = useState(false);
  const n = dates.length;

  // A pinned touch readout clears when the user taps anywhere outside the chart.
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!figureRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setActive(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pinned]);

  const formatValue = (value: number, compact = false) =>
    format.kind === "currency"
      ? fmt.currency(value, format.currency, { compact })
      : format.kind === "roas"
        ? fmt.roas(value)
        : fmt.number(value, { compact });

  const maxValue = Math.max(0, reference?.value ?? 0, ...series.flatMap((s) => s.values));
  const { max, ticks } = niceScale(maxValue);
  const y = (v: number) => 100 - (v / max) * 100;
  const x = (i: number) => (mark === "column" ? ((i + 0.5) / n) * 100 : n === 1 ? 50 : (i / (n - 1)) * 100);

  if (n === 0) {
    return <p className="py-10 text-center text-sm text-ink-2">{dict.common.noData}</p>;
  }

  const indexFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return mark === "column" ? Math.min(n - 1, Math.floor(ratio * n)) : Math.round(ratio * (n - 1));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : n - 1);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    setActive((current) => Math.min(n - 1, Math.max(0, (current ?? n - 1) + step)));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setActive(indexFromPointer(event));
    if (event.pointerType !== "mouse") setPinned(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // Mouse: hover. Touch/pen: only while pressed (a sideways drag scrubs).
    if (event.pointerType === "mouse" || event.buttons > 0) setActive(indexFromPointer(event));
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") setActive(null);
  };
  // The browser took over the gesture (vertical scroll): drop the readout.
  const onPointerCancel = () => {
    setPinned(false);
    setActive(null);
  };

  const activeX = active !== null ? x(active) : 0;

  return (
    <figure ref={figureRef} className="m-0">
      {series.length > 1 ? (
        <figcaption dir={dir} className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("inline-block", mark === "line" ? "h-0.5 w-4 rounded-full" : "size-2.5 rounded-sm")}
                style={{ background: COLOR_VAR[s.color] }}
              />
              {s.label}
            </span>
          ))}
        </figcaption>
      ) : (
        <figcaption className="sr-only">{title}</figcaption>
      )}

      {/* Time always runs left → right, also in RTL layouts. */}
      <div dir="ltr" className="relative h-[200px] select-none sm:h-[248px]">
        {/* Y-axis labels */}
        <div aria-hidden className="absolute top-0 bottom-7 left-0 w-12">
          {ticks.map((tick) => (
            <span
              key={tick}
              dir={dir}
              className="tabular absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-axis"
              style={{ top: `${y(tick)}%` }}
            >
              {formatValue(tick, true)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div className="absolute top-0 right-1 bottom-7 left-12">
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {ticks.map((tick) => (
              <line
                key={tick}
                x1="0"
                x2="100"
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? "var(--line-strong)" : "var(--line)"}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {reference ? (
              <line
                x1="0"
                x2="100"
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke="var(--ink-3)"
                strokeWidth="1"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {mark === "line"
              ? series.map((s) => {
                  const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
                  return (
                    <g key={s.id}>
                      {series.length === 1 ? (
                        <polygon
                          points={`${x(0)},100 ${points} ${x(n - 1)},100`}
                          fill={COLOR_VAR[s.color]}
                          fillOpacity="0.1"
                        />
                      ) : null}
                      <polyline
                        points={points}
                        fill="none"
                        stroke={COLOR_VAR[s.color]}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })
              : null}
          </svg>

          {mark === "column" ? (
            <div aria-hidden className="absolute inset-0 flex items-end gap-[2px]">
              {series[0]?.values.map((v, i) => (
                <div key={dates[i]} className="flex h-full flex-1 items-end justify-center">
                  <div
                    className="w-full max-w-6 rounded-t-[4px] transition-opacity"
                    style={{
                      height: `${(v / max) * 100}%`,
                      background: COLOR_VAR[series[0].color],
                      opacity: active === null || active === i ? 1 : 0.45,
                    }}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {reference ? (
            <span
              dir={dir}
              className="absolute right-1 -translate-y-full pb-0.5 text-[11px] text-ink-2"
              style={{ top: `${y(reference.value)}%` }}
            >
              {reference.label}
            </span>
          ) : null}

          {/* End dots (line) */}
          {mark === "line" && active === null
            ? series.map((s) => (
                <span
                  key={s.id}
                  aria-hidden
                  className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                  style={{ left: `${x(n - 1)}%`, top: `${y(s.values[n - 1] ?? 0)}%`, background: COLOR_VAR[s.color] }}
                />
              ))
            : null}

          {/* Crosshair + readout */}
          {active !== null ? (
            <>
              {mark === "line" ? (
                <span aria-hidden className="absolute inset-y-0 w-px bg-line-strong" style={{ left: `${activeX}%` }} />
              ) : null}
              {mark === "line"
                ? series.map((s) => (
                    <span
                      key={s.id}
                      aria-hidden
                      className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                      style={{ left: `${activeX}%`, top: `${y(s.values[active] ?? 0)}%`, background: COLOR_VAR[s.color] }}
                    />
                  ))
                : null}
              <div
                dir={dir}
                role="status"
                className={cn(
                  "pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg",
                  activeX > 55 ? "-translate-x-[calc(100%+10px)]" : "translate-x-[10px]",
                )}
                style={{ left: `${activeX}%` }}
              >
                <p className="mb-1 text-ink-2">{fmt.date(dates[active])}</p>
                {series.map((s) => (
                  <p key={s.id} className="flex items-center gap-2">
                    <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: COLOR_VAR[s.color] }} />
                    <span className="tabular font-semibold text-ink">{formatValue(s.values[active] ?? 0)}</span>
                    <span className="text-ink-2">{s.label}</span>
                  </p>
                ))}
              </div>
            </>
          ) : null}

          {/* Interaction layer — larger than the marks. */}
          <div
            tabIndex={0}
            role="img"
            aria-label={title}
            aria-describedby={tableId}
            className="absolute inset-0 cursor-crosshair touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerLeave={onPointerLeave}
            onPointerCancel={onPointerCancel}
            onFocus={() => setActive((current) => current ?? n - 1)}
            onBlur={() => {
              if (!pinned) setActive(null);
            }}
            onKeyDown={onKeyDown}
          />
        </div>

        {/* X-axis labels */}
        <div aria-hidden className="absolute right-1 bottom-0 left-12 h-6">
          {xLabelIndices(n).map((i, position, all) => (
            <span
              key={i}
              dir={dir}
              className={cn(
                "tabular absolute top-1.5 text-[11px] whitespace-nowrap text-axis",
                // On phones keep only first, middle and last labels so they never collide.
                all.length > 3 && position !== 0 && position !== all.length - 1 && position !== Math.floor(all.length / 2) && "hidden sm:block",
                i === 0 && mark === "line" ? "" : i === n - 1 && mark === "line" ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${x(i)}%` }}
            >
              {fmt.date(dates[i], "short")}
            </span>
          ))}
        </div>
      </div>

      <details id={tableId} className="group mt-3 text-sm">
        <summary className="cursor-pointer py-1 text-xs text-ink-2 hover:text-ink pointer-coarse:py-2.5">
          <span className="group-open:hidden">{dict.common.showTable}</span>
          <span className="hidden group-open:inline">{dict.common.hideTable}</span>
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-start font-medium text-ink-2">
                  {dict.common.date}
                </th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="px-3 py-1.5 text-end font-medium text-ink-2">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => (
                <tr key={date} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 text-start font-normal whitespace-nowrap text-ink-2">
                    {fmt.date(date)}
                  </th>
                  {series.map((s) => (
                    <td key={s.id} className="tabular px-3 py-1.5 text-end text-ink">
                      {formatValue(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
