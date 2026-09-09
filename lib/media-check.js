// ============================================================================
// Diagnostics that distinguish WHERE playback is failing:
//
//   runMediaCheck()  — fetches the first 64 KB of the movie through the same
//                      tunnel URL the <video> element uses. If this fails,
//                      the problem is the tunnel/server path, not the player.
//                      If it succeeds, bytes ARE reaching the browser and the
//                      problem is almost always the file's CODEC.
//
//   codecSupport()   — asks the browser which video codecs it can decode.
//                      "" = cannot play. H.264 should always be "probably";
//                      HEVC/H.265 is "" in Chrome/Edge/Firefox on most Windows
//                      PCs — and Dailymotion/phone downloads are frequently
//                      HEVC even when named .mp4.
// ============================================================================

export async function runMediaCheck(mediaUrl) {
  const started = Date.now();
  try {
    const res = await fetch(mediaUrl, {
      headers: { Range: "bytes=0-65535" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const ms = Math.max(1, Date.now() - started);
    if (!res.ok) {
      return { ok: false, status: res.status, ms, reason: `HTTP ${res.status}` };
    }
    await res.arrayBuffer(); // actually pull the bytes, like the player would
    return { ok: true, status: res.status, ms };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started, reason: "unreachable" };
  }
}

export function codecSupport() {
  if (typeof document === "undefined") return null;
  try {
    const v = document.createElement("video");
    const t = (type) => v.canPlayType(type); // "probably" | "maybe" | ""
    return {
      h264: t('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      hevc: t('video/mp4; codecs="hvc1"'),
      vp9: t('video/webm; codecs="vp9"'),
    };
  } catch {
    return null;
  }
}
