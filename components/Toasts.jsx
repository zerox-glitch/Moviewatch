"use client";

const TONES = {
  info: "border-night-600 bg-night-800/95 text-slate-200",
  success: "border-emerald-500/40 bg-emerald-950/90 text-emerald-200",
  error: "border-red-500/40 bg-red-950/90 text-red-200",
};

export default function Toasts({ items }) {
  if (!items?.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${TONES[t.tone] || TONES.info}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
