// ============================================================================
// Subtitle helpers: labels, language detection, and sync-offset shifting.
// Browsers play WebVTT — the media server converts .srt files automatically,
// so every track we add here is already a .vtt response.
// ============================================================================

/** Detect a language code in a subtitle filename: "movie.en.srt" -> "en". */
export function langFromName(name) {
  const m = /\.([a-z]{2,3})\.(?:srt|vtt)$/i.exec(name || "");
  if (!m) return null;
  const c = m[1].toLowerCase();
  // avoid treating part of the title as a language when it clearly isn't
  return c === "sub" || c === "vtt" ? null : c;
}

const LANG_NAMES = {
  en: "English", es: "Español", hi: "हिन्दी", ur: "اردو", ar: "العربية",
  fr: "Français", de: "Deutsch", pt: "Português", ru: "Русский", tr: "Türkçe",
  zh: "中文", ja: "日本語", ko: "한국어", it: "Italiano", fa: "فارسی", bn: "বাংলা", pa: "ਪੰਜਾਬੀ",
};

/** Pretty label for a picker: "Movie.2023.ur.srt" -> "اردو (ur)". */
export function prettySubLabel(name) {
  const base = (name || "").replace(/\.(srt|vtt)$/i, "");
  const lang = langFromName(name);
  if (lang && LANG_NAMES[lang]) return `${LANG_NAMES[lang]} (${lang})`;
  if (lang) return base.slice(-lang.length - 1) === `.${lang}` ? `${lang.toUpperCase()} subtitle` : base;
  return base;
}

/**
 * Shift every cue on a loaded TextTrack by `delta` seconds.
 * VTTCue start/end times are writable, so this is the standard trick for
 * "the subtitles run 2 seconds early" — a classic when the movie and the
 * subtitle file come from different releases (23.976 vs 25 fps, etc.).
 * Returns false if the track's cues aren't loaded yet.
 */
export function shiftCues(track, delta) {
  if (!track || !track.cues) return false;
  const cues = track.cues;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    cue.startTime = Math.max(0, cue.startTime + delta);
    cue.endTime = Math.max(0.05, cue.endTime + delta);
  }
  return true;
}

/** Wait (poll) until a TextTrack's cues are parsed, then resolve with it. */
export function whenCuesReady(track, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!track) return resolve(null);
    if (track.cues && track.cues.length) return resolve(track);
    const started = Date.now();
    const iv = setInterval(() => {
      if (track.cues && track.cues.length) {
        clearInterval(iv);
        resolve(track);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        resolve(track); // give up — let callers no-op gracefully
      }
    }, 100);
  });
}
