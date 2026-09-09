// Small shared formatting helpers.

/** 81 -> "1:21", 3675 -> "1:01:15" */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "movie file (1).mp4" -> "movie-file-1.mp4" */
export function shortName(name, max = 42) {
  if (!name) return "";
  return name.length > max ? `${name.slice(0, max - 1)}…${name.slice(-6)}` : name;
}

/** Guess the video.js source type from a URL. */
export function guessSourceType(url) {
  if (!url) return "video/mp4";
  if (/\.m3u8(\?|$)/i.test(url)) return "application/x-mpegURL";
  if (/\.mpd(\?|$)/i.test(url)) return "application/dash+xml";
  if (/\.webm(\?|$)/i.test(url)) return "video/webm";
  if (/\.ogv(\?|$)/i.test(url)) return "video/ogg";
  if (/\.mov(\?|$)/i.test(url)) return "video/quicktime";
  return "video/mp4";
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
