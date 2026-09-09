"use client";

// ============================================================================
// VolumeControl — LOCAL volume (per person, on purpose: you shouldn't be able
// to change what your partner hears). Slides 0-100% + mute toggle.
// ============================================================================

export default function VolumeControl({ volume, muted, onVolume, onToggleMute }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-night-600 bg-night-900/60 px-3 py-2">
      <button
        onClick={onToggleMute}
        title={muted ? "Unmute (only for you)" : "Mute (only for you)"}
        className="text-base leading-none transition hover:scale-110"
      >
        {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round((muted ? 0 : volume) * 100)}
        onChange={(e) => onVolume(Number(e.target.value) / 100)}
        aria-label="Volume (only for you)"
        className="h-1.5 w-20 cursor-pointer accent-[#8b5cf6]"
      />
      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-slate-500">
        {Math.round((muted ? 0 : volume) * 100)}%
      </span>
    </div>
  );
}
