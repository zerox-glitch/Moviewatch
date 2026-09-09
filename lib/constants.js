// ============================================================================
// App-wide tuning knobs. Change these to adjust sync behavior.
// ============================================================================

/** How often the HOST pushes state while PLAYING (ms). Also the position-save cadence. */
export const HOST_PUSH_PLAYING_MS = 1000;

/** How often the HOST heartbeats while PAUSED, so guests know it's still there (ms). */
export const HOST_HEARTBEAT_PAUSED_MS = 4000;

/** How often the HOST polls the media server for guest requests (ms). */
export const HOST_REQUEST_POLL_MS = 400;

/** How often the GUEST polls the host device for playback state (ms). */
export const GUEST_POLL_MS = 400;

/** Guest: jump to the host's position when drift exceeds this many seconds. */
export const SYNC_TOLERANCE_S = 2.5;

/** Guest: nudge playback rate (instead of jumping) when drift exceeds this. */
export const SOFT_DRIFT_S = 0.35;
// Once a hard resync happens, don't allow another for this long — frequent
// visible seeks are far more annoying than being a couple of seconds off.
export const SEEK_COOLDOWN_MS = 6000;

/** A host counts as online if its last state push was within this window (ms). */
export const HOST_ONLINE_WINDOW_MS = 5000;

/** Minimum gap between identical guest REQUESTS (ms) — spam guard. */
export const REQUEST_THROTTLE_MS = 500;

/** Seek buttons jump this many seconds. */
export const SEEK_STEP_S = 10;

/** Subtitle sync buttons adjust by this many seconds per tap. */
export const SUBTITLE_OFFSET_STEP_S = 0.5;
