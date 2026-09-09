// ============================================================================
// Invite-link helpers.
//
// The app has NO database now — a "room" is identified by two things:
//   · a 6-character code (e.g. K7QM2X)
//   · the host device's public tunnel URL (e.g. https://xyz.trycloudflare.com)
//
// Invite link format:  https://yourapp.vercel.app/room/K7QM2X?s=https%3A%2F%2Fxyz.trycloudflare.com
// ============================================================================

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 — typo-safe

/** Random 6-character room code, generated in the browser. */
export function randomRoomCode(len = 6) {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

/**
 * Normalize a media-server base URL.
 * Accepts bare hosts, adds https://, collapses to origin, strips trailing /.
 * Returns null for anything that isn't https (except localhost — handy for
 * developing with both apps on one machine).
 */
export function normalizeServerUrl(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    u = new URL(u).origin;
  } catch {
    return null;
  }
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(u);
  if (!u.startsWith("https://") && !isLocal) return null;
  return u;
}

/** Build the link the host sends to their co-watcher. */
export function buildInviteLink(appOrigin, code, serverUrl) {
  return `${appOrigin}/room/${code}?s=${encodeURIComponent(serverUrl)}`;
}

/**
 * Parse an invite link pasted by the guest.
 * Accepts full URLs and is lenient about a missing https:// prefix.
 * Returns { code, serverUrl } or null if it doesn't look like one.
 */
export function parseInviteLink(text) {
  if (!text) return null;
  let t = String(text).trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    const m = /\/room\/([A-Za-z0-9]{4,12})\/?$/.exec(u.pathname);
    if (!m) return null;
    const serverUrl = normalizeServerUrl(u.searchParams.get("s") || "");
    if (!serverUrl) return null;
    return { code: m[1].toUpperCase(), serverUrl };
  } catch {
    return null;
  }
}
