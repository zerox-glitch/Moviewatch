// ============================================================================
// Client for the Moviewatch media server (server/moviewatch.py),
// reached through the host's tunnel URL (Cloudflare or ngrok).
//
// Every function takes `serverUrl` = the https://xxx.trycloudflare.com (or
// xxx.ngrok-free.app) origin. Requests are JSON and short-timeouted; errors
// thrown carry `.offline = true` when the host device can't be reached.
// ============================================================================

async function request(serverUrl, path, { method = "GET", body, timeoutMs = 6000 } = {}) {
  let res;
  try {
    res = await fetch(`${serverUrl}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    const err = new Error("The host device is unreachable right now.");
    err.offline = true;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response (proxy error page etc.) */
  }

  if (!res.ok || !data?.ok) {
    const err = new Error(data?.message || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.code = data?.error;
    throw err;
  }
  return data;
}

export const api = {
  /** Quick reachability check. */
  health: (s) => request(s, "/api/health", { timeoutMs: 5000 }),

  /** Current room state: { room: {file, subtitle, current_time, is_playing, host_online, media_url, subtitle_url} } */
  room: (s, code) => request(s, `/api/rooms/${encodeURIComponent(code)}`),

  /** Register this room code on the host device (host's browser only). */
  register: (s, code) => request(s, "/api/rooms", { method: "POST", body: { code } }),

  /** Media in the host's folder: { videos: [...], subtitles: [...] } */
  files: (s, code) => request(s, `/api/files?k=${encodeURIComponent(code)}`),

  /** Host picks the movie (server auto-matches a subtitle if one matches by name). */
  select: (s, code, file) =>
    request(s, `/api/rooms/${encodeURIComponent(code)}/select`, { method: "POST", body: { file } }),

  /** Host changes the subtitle track: filename or null for none. */
  setSubtitle: (s, code, file) =>
    request(s, `/api/rooms/${encodeURIComponent(code)}/subtitle`, { method: "POST", body: { file } }),

  /** Host pushes playback state (also acts as the host heartbeat). */
  pushState: (s, code, currentTime, isPlaying) =>
    request(s, `/api/rooms/${encodeURIComponent(code)}/state`, {
      method: "POST",
      body: { current_time: currentTime, is_playing: isPlaying },
      timeoutMs: 4000,
    }),

  /** Guest asks the host: play | pause | seek (with signed amount in seconds). */
  sendRequest: (s, code, action, amount) =>
    request(s, `/api/rooms/${encodeURIComponent(code)}/requests`, {
      method: "POST",
      body: amount === undefined ? { action } : { action, amount },
      timeoutMs: 4000,
    }),

  /** Host polls guest requests newer than `after`. */
  requests: (s, code, after) =>
    request(s, `/api/rooms/${encodeURIComponent(code)}/requests?after=${after}`, { timeoutMs: 4000 }),
};

/** Fire-and-forget state push that survives tab close (host pagehide). */
export function pushStateKeepalive(serverUrl, code, currentTime, isPlaying) {
  try {
    fetch(`${serverUrl}/api/rooms/${encodeURIComponent(code)}/state`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_time: currentTime, is_playing: isPlaying }),
    });
  } catch {
    /* best effort */
  }
}
