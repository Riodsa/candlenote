"use client";

import { TiltFlag } from "@/lib/api";

const TILT_META: Record<TiltFlag, { label: string; cls: string }> = {
  revenge: {
    label: "Revenge",
    cls: "bg-rose-500/15 text-rose-400 border-rose-500/35",
  },
  size_up: {
    label: "Lot \u2191",
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/35",
  },
  after_loss_streak: {
    label: "Streak Tilt",
    cls: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/35",
  },
  no_sl: {
    label: "No SL",
    cls: "bg-orange-500/15 text-orange-400 border-orange-500/35",
  },
};

export function TiltBadges({ flags }: { flags?: TiltFlag[] }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {flags.map((f) => {
        const m = TILT_META[f];
        if (!m) return null;
        return (
          <span
            key={f}
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold leading-tight ${m.cls}`}
          >
            {m.label}
          </span>
        );
      })}
    </div>
  );
}
