"use client";

// ============================================================================
// FilePicker — the host picks which movie in their folder to watch.
// (No upload: the file is already on their disk; the media server streams it.)
// If a .srt/.vtt sits next to the movie with the same name, subtitles attach
// automatically (the server does the matching when you pick).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/server-api";
import { formatBytes, shortName, isRiskyVideo } from "@/lib/format";

function codecBadge(f) {
  const pr = f.probe;
  if (!pr) return null;
  if (pr.container === "other" || isRiskyVideo(f.name)) {
    return (
      <span
        className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase text-amber-300"
        title="Browsers can't play this format — convert to MP4 with HandBrake (see README)"
      >
        ⚠ won&apos;t play
      </span>
    );
  }
  if (pr.codec === "hevc")
    return (
      <span
        className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold uppercase text-red-300"
        title="This MP4 contains HEVC/H.265 video, which browsers can't decode — HandBrake it to H.264"
      >
        HEVC ✗
      </span>
    );
  if (pr.codec === "h264")
    return (
      <span
        className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300"
        title="Verified H.264 video — plays in every browser"
      >
        H.264 ✓
      </span>
    );
  if (pr.codec === "av1")
    return (
      <span className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">
        AV1 ✓
      </span>
    );
  if (pr.codec === "vp9")
    return (
      <span className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">
        VP9 ✓
      </span>
    );
  if (pr.codec === "mpeg4")
    return (
      <span
        className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-bold uppercase text-red-300"
        title="Old MPEG-4 video — browsers usually can't decode it — HandBrake it to H.264"
      >
        MPEG-4 ✗
      </span>
    );
  return null;
}

export default function FilePicker({ serverUrl, roomId, currentFile, onPicked, onCancel }) {
  const [videos, setVideos] = useState(null);
  const [subCount, setSubCount] = useState(0);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setVideos(null);
    try {
      const data = await api.files(serverUrl, roomId);
      setVideos(data.videos || []);
      setSubCount((data.subtitles || []).length);
    } catch (e) {
      setError(e.offline ? "Lost contact with your device — is it still running?" : e.message);
    }
  }, [serverUrl, roomId]);

  useEffect(() => {
    load();
  }, [load]);

  async function pick(file) {
    setPicking(file.name);
    try {
      await api.select(serverUrl, roomId, file.name);
      onPicked?.(file.name);
    } catch (e) {
      setError(e.offline ? "Lost contact with your device." : e.message);
      setPicking(null);
    }
  }

  return (
    <div className="rounded-xl border border-night-600 bg-night-800/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <span className="text-xl">📁</span> Pick a movie from your folder
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Add files any time — press Refresh. MP4 (H.264 + AAC) plays on everything.
            {subCount > 0 && (
              <>
                {" "}
                <span className="text-glow-300">
                  {subCount} subtitle file{subCount === 1 ? "" : "s"} found — drop a{" "}
                  <code className="rounded bg-black/30 px-1">.srt</code> next to the movie with
                  the same name and it attaches automatically.
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-lg border border-night-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-night-700"
          >
            ↻ Refresh
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-lg border border-night-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-night-700"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {videos === null && !error && (
        <div className="flex items-center justify-center gap-3 py-10 text-slate-400">
          <svg className="h-5 w-5 animate-spin text-glow-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Reading your folder…
        </div>
      )}

      {videos && videos.length === 0 && (
        <div className="mt-4 rounded-lg border border-night-600 bg-night-900/50 px-4 py-8 text-center text-sm text-slate-400">
          No video files found in your movies folder yet. Drop some files in there and press
          <span className="font-semibold text-white"> Refresh</span>.
        </div>
      )}

      {videos && videos.length > 0 && (
        <ul className="thin-scroll mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
          {videos.map((f) => {
            const active = f.name === currentFile;
            return (
              <li key={f.name}>
                <button
                  onClick={() => pick(f)}
                  disabled={picking !== null}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition disabled:opacity-60 ${
                    active
                      ? "border-glow-500/60 bg-glow-500/10"
                      : "border-night-600 bg-night-900/50 hover:border-glow-500/40 hover:bg-night-700/50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {active && "▶ "}
                      {shortName(f.name, 60)}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {formatBytes(f.size)}
                      {active && " · currently loaded"}
                    </span>
                  </span>
                  {codecBadge(f)}
                  <span className="shrink-0 rounded-lg bg-glow-600 px-3 py-1.5 text-xs font-bold text-white">
                    {picking === f.name ? "Loading…" : active ? "Reload" : "Watch"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
