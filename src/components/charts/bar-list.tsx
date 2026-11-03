/**
 * Ranked horizontal bars for nominal categories (one series → one colour).
 * Values are printed at the bar tip, so nothing depends on hover. Bars grow from
 * the inline-start edge, so they mirror correctly in RTL.
 */
export function BarList({
  items,
  label,
}: {
  label: string;
  items: { id: string; label: string; value: number; display: string; note?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul aria-label={label} className="space-y-3.5">
      {items.map((item) => (
        <li key={item.id} title={`${item.label}: ${item.display}`}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-ink">{item.label}</span>
            <span className="shrink-0 text-ink-2">
              <span className="tabular font-medium text-ink">{item.display}</span>
              {item.note ? <span className="ms-1.5 text-xs">{item.note}</span> : null}
            </span>
          </div>
          <div className="h-2 rounded-e-[4px] bg-surface-2">
            <div
              className="h-2 rounded-e-[4px] bg-series-1"
              style={{ width: `${Math.max(item.value > 0 ? 1.5 : 0, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
