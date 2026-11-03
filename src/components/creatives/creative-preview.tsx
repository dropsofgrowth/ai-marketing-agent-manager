import { Clapperboard, ImageIcon } from "lucide-react";

import type { AspectRatio, CreativeFormat } from "@/domain/types";
import { hashString } from "@/integrations/mock-data/random";
import { cn } from "@/lib/cn";

const RATIO: Record<AspectRatio, string> = { "1:1": "1 / 1", "4:5": "4 / 5", "9:16": "9 / 16", "16:9": "16 / 9" };

/**
 * Deterministic placeholder for mock creatives (no real asset exists yet).
 * When a live Higgsfield adapter returns `assetUrl`, render the asset instead.
 */
export function CreativePreview({
  seedKey,
  format,
  aspectRatio,
  headline,
  label,
  className,
  compact = false,
}: {
  seedKey: string;
  format: CreativeFormat;
  aspectRatio: AspectRatio;
  headline?: string | null;
  label: string;
  className?: string;
  /** Small thumbnails hide the overlay labels. */
  compact?: boolean;
}) {
  // Avalanche the hash so similar ids still get clearly different hues.
  let h = hashString(seedKey);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 30 + ((h >>> 9) % 60)) % 360;
  const Icon = format === "VIDEO" ? Clapperboard : ImageIcon;

  return (
    <div
      role="img"
      aria-label={headline ? `${label}: ${headline}` : label}
      className={cn("relative overflow-hidden rounded-lg", className)}
      style={{
        aspectRatio: RATIO[aspectRatio],
        background: `radial-gradient(120% 80% at 20% 10%, hsl(${hue} 75% 72% / 0.9), transparent 60%), linear-gradient(145deg, hsl(${hue} 55% 52%), hsl(${hue2} 50% 28%))`,
      }}
    >
      <span className="absolute start-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <Icon aria-hidden className="size-3" />
        {compact ? null : <bdi>{aspectRatio}</bdi>}
      </span>
      {compact ? null : (
        <span className="absolute end-2 top-2 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {label}
        </span>
      )}
      {headline && !compact ? (
        <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pt-8 pb-3 text-sm leading-snug font-semibold text-white">
          {headline}
        </p>
      ) : null}
    </div>
  );
}
