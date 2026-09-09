"use client";

// ============================================================================
// RoomClient — the watch-party engine (streams straight from the host's PC).
//
// All state lives on the host's device (server/moviewatch.py), reached through
// a tunnel URL. Both browsers poll it:
//
//   HOST  — source of truth. Pushes {current_time, is_playing} on every
//           play/pause/seek (incl. ±10s buttons), plus a 1s heartbeat while
//           playing. Polls the request queue and applies guest requests.
//   GUEST — passive. Polls every 400ms and reconciles: jump if >0.5s off,
//           gentle rate-nudge between 0.15–0.5s. Buttons only send REQUESTS.
//
// Controls
//   Synced:      play/pause, position, seeks, which movie/subtitle track
//   Local only:  volume/mute, subtitles on/off + sync offset, fullscreen
//
// The movie + subtitles stream from the host's disk via the tunnel; the
// server converts .srt -> WebVTT on the fly.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import VideoPlayer from "@/components/VideoPlayer";
import Toasts from "@/components/Toasts";
import DeviceConnect from "@/components/DeviceConnect";
import FilePicker from "@/components/FilePicker";
import VolumeControl from "@/components/VolumeControl";
import { api, pushStateKeepalive } from "@/lib/server-api";
import { normalizeServerUrl } from "@/lib/invite";
import { prettySubLabel, shiftCues, whenCuesReady } from "@/lib/subtitles";
import { formatTime, shortName, isRiskyVideo } from "@/lib/format";
import { runMediaCheck, codecSupport } from "@/lib/media-check";
import {
  GUEST_POLL_MS,
  HOST_HEARTBEAT_PAUSED_MS,
  HOST_PUSH_PLAYING_MS,
  HOST_REQUEST_POLL_MS,
  HOST_ONLINE_WINDOW_MS,
  REQUEST_THROTTLE_MS,
  SEEK_STEP_S,
  SOFT_DRIFT_S,
  SUBTITLE_OFFSET_STEP_S,
  SYNC_TOLERANCE_S,
} from "@/lib/constants";

const LS_HOST_SERVER = (roomId) => `moviewatch:host-server:${roomId}`;
const LS_VOLUME = "moviewatch:volume";
const LS_CC_ON = "moviewatch:cc-on";

export default function RoomClient({ roomId }) {
  // ---- lifecycle / role -----------------------------------------------------
  const [phase, setPhase] = useState("booting"); // booting | ready | error
  const [fatal, setFatal] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [serverUrl, setServerUrl] = useState(null);
  const serverUrlRef = useRef(null);
  serverUrlRef.current = serverUrl;

  // ---- room state from the media server --------------------------------------
  const [room, setRoom] = useState(null);
  const roomRef = useRef(null);
  roomRef.current = room;
  const recvAtRef = useRef(0);
  const [conn, setConn] = useState("connecting");

  // ---- media ------------------------------------------------------------------
  const playerRef = useRef(null);
  const [playerBump, setPlayerBump] = useState(0); // increments when a player is ready
  const initialTimeRef = useRef(0);
  const [videoSrc, setVideoSrc] = useState(null);
  const lastFileRef = useRef(null);
  const [pickingFile, setPickingFile] = useState(false);
  const [subFiles, setSubFiles] = useState([]); // for the host's subtitle picker

  // ---- host internals ----------------------------------------------------------
  const lastPushRef = useRef(0);
  const reqCursorRef = useRef(0);
  const lastActionRef = useRef({ action: null, amount: null, at: 0 });

  // ---- guest internals -----------------------------------------------------------
  const [drift, setDrift] = useState(null);
  const [needUnmute, setNeedUnmute] = useState(false);

  // ---- subtitles (local: on/off + offset are per-person) -------------------------
  const [ccOn, setCcOn] = useState(true);
  const [subOffset, setSubOffset] = useState(0); // seconds, display only
  const subTrackRef = useRef(null);

  // ---- volume (local) -------------------------------------------------------------
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  // ---- ui -----------------------------------------------------------------------
  const [toasts, setToasts] = useState([]);
  // Playback diagnostics: is the media URL reachable, and what can this browser decode?
  const [mediaCheck, setMediaCheck] = useState(null);
  const codecs = useRef(null);
  const [hostPlaying, setHostPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [nowAt, setNowAt] = useState(0);

  const pushToast = useCallback((message, tone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((ts) => [...ts.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 6000);
  }, []);

  // Probe the media URL + codec support once a movie is selected.
  useEffect(() => {
    if (!videoSrc) { setMediaCheck(null); return; }
    let alive = true;
    if (!codecs.current) codecs.current = codecSupport();
    setMediaCheck(null);
    runMediaCheck(videoSrc).then((r) => { if (alive) setMediaCheck(r); });
    return () => { alive = false; };
  }, [videoSrc]);

  async function copyDirectLink() {
    if (!videoSrc) return;
    try {
      await navigator.clipboard.writeText(videoSrc);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = videoSrc;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    pushToast("🔗 Direct link copied — open it in a NEW browser tab", "info");
  }

  const adoptView = useCallback(
    (view) => {
      recvAtRef.current = Date.now();
      setRoom(view);
      setConn("online");

      if (view.file !== lastFileRef.current) {
        // Movie changed (first load, host picked, or a page refresh) — start
        // at the server's saved position (0 for a brand-new pick).
        lastFileRef.current = view.file;
        initialTimeRef.current = view.current_time || 0;
        setVideoSrc(view.media_url ? `${serverUrlRef.current}${view.media_url}` : null);
      }
    },
    []
  );

  // ==========================================================================
  // 1. Bootstrap — role + server URL from the invite link / localStorage
  // ==========================================================================
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsHost = params.get("role") === "host";
    const fromUrl = normalizeServerUrl(params.get("s") || "");
    const saved = window.localStorage.getItem(LS_HOST_SERVER(roomId));
    const fromStorage = normalizeServerUrl(saved || "");

    // local prefs
    const v = parseFloat(window.localStorage.getItem(LS_VOLUME) ?? "1");
    if (Number.isFinite(v)) setVolume(Math.min(1, Math.max(0, v)));
    if (window.localStorage.getItem(LS_CC_ON) === "0") setCcOn(false);

    if (wantsHost) {
      setIsHost(true);
      const s = fromUrl || fromStorage;
      setServerUrl(s || null);
      setPhase("ready");
      return;
    }

    if (fromUrl) {
      setServerUrl(fromUrl);
      setPhase("ready");
      return;
    }

    setPhase("error");
    setFatal({
      title: "This link is incomplete",
      detail:
        "It's missing the part that points at the host's device. Ask for a fresh invite link — it looks like …/room/CODE?s=https%3A%2F%2F…",
    });
  }, [roomId]);

  // ==========================================================================
  // 2. Polling — keep `room` fresh
  // ==========================================================================
  useEffect(() => {
    if (phase !== "ready" || !serverUrl) return;
    let stop = false;

    const tick = async () => {
      try {
        const { room: view } = await api.room(serverUrl, roomId);
        if (stop) return;

        if (isHost) {
          setConn("online");
          // The host never adopts playback state from the server (it IS the
          // source of truth) but does track the device link + subtitle choice.
          setRoom((prev) => {
            if (!prev) return view;
            return prev.file === view.file
              ? { ...prev, host_online: view.host_online, subtitle: view.subtitle }
              : view;
          });
          if (view.file !== lastFileRef.current) {
            lastFileRef.current = view.file;
            initialTimeRef.current = view.current_time || 0;
            setVideoSrc(view.media_url ? `${serverUrlRef.current}${view.media_url}` : null);
          }
        } else {
          adoptView(view);
        }
      } catch (e) {
        if (stop) return;
        if (e.offline) {
          setConn("offline");
        } else if (e.code === "room_not_registered") {
          setConn("online");
          if (!isHost) {
            setPhase("error");
            setFatal({
              title: "The host hasn't connected this room yet",
              detail:
                `Your link is valid and the host's device is online, but room ${roomId} ` +
                "isn't set up on it. Ask the host to open their room link again.",
            });
          }
        }
      }
    };

    tick();
    const iv = setInterval(tick, GUEST_POLL_MS);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [phase, serverUrl, roomId, isHost, adoptView]);

  // Host: fetch the folder's subtitle list once for the picker
  useEffect(() => {
    if (phase !== "ready" || !isHost || !serverUrl) return;
    api
      .files(serverUrl, roomId)
      .then(({ subtitles }) => setSubFiles(subtitles || []))
      .catch(() => {});
  }, [phase, isHost, serverUrl, roomId, room?.file]);

  // ==========================================================================
  // 3. GUEST — reconciliation loop + host-online tracking
  // ==========================================================================
  useEffect(() => {
    if (phase !== "ready" || isHost || !serverUrl) return;

    const iv = setInterval(() => {
      const player = playerRef.current;
      const view = roomRef.current;

      const fresh = Date.now() - recvAtRef.current < HOST_ONLINE_WINDOW_MS;
      setConn((c) => (fresh ? "online" : "offline"));

      if (!player || !view || !view.file) return;

      const hostUp = view.host_online;
      const playing = view.is_playing && hostUp; // host gone -> freeze like a pause

      if (playing) {
        if (player.paused()) {
          const attempt = player.play();
          attempt?.then(() => setNeedUnmute(false)).catch(() => {
            if (!player.muted()) {
              player.muted(true);
              const mutedPlay = player.play();
              mutedPlay?.then(() => setNeedUnmute(true)).catch(() => {});
            }
          });
        }
      } else if (!player.paused()) {
        player.pause();
      }

      // drift correction vs extrapolated host position
      const elapsed = playing ? Math.max(0, (Date.now() - recvAtRef.current) / 1000) : 0;
      const expected = (view.current_time || 0) + elapsed;
      const d = player.currentTime() - expected;

      if (Math.abs(d) > SYNC_TOLERANCE_S) {
        player.currentTime(Math.max(0, expected));
        player.playbackRate(1);
      } else if (playing && Math.abs(d) > SOFT_DRIFT_S) {
        player.playbackRate(d > 0 ? 0.97 : 1.03);
      } else if (player.playbackRate() !== 1) {
        player.playbackRate(1);
      }
      setDrift(Math.round(d * 100) / 100);
    }, GUEST_POLL_MS);

    return () => clearInterval(iv);
  }, [phase, isHost, serverUrl]);

  // ==========================================================================
  // 4. HOST — push state + apply guest requests
  // ==========================================================================
  const pushNow = useCallback(() => {
    const player = playerRef.current;
    const s = serverUrlRef.current;
    if (!player || !s || !roomRef.current?.file) return;
    const t = player.currentTime();
    const playing = !player.paused() && !player.ended();
    lastPushRef.current = Date.now();
    api
      .pushState(s, roomId, t, playing)
      .then(() => setConn("online"))
      .catch((e) => {
        if (e.offline) setConn("offline");
      });
  }, [roomId]);

  useEffect(() => {
    if (phase !== "ready" || !isHost || !serverUrl || !room?.file) return;

    const iv = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      setNowAt(Math.floor(player.currentTime()));

      const playing = !player.paused() && !player.ended();
      const due = playing ? HOST_PUSH_PLAYING_MS : HOST_HEARTBEAT_PAUSED_MS;
      if (Date.now() - lastPushRef.current >= due) pushNow();
    }, HOST_PUSH_PLAYING_MS / 2);

    return () => clearInterval(iv);
  }, [phase, isHost, serverUrl, room?.file, pushNow]);

  // Host: poll & apply guest requests
  useEffect(() => {
    if (phase !== "ready" || !isHost || !serverUrl) return;
    let stop = false;
    let primed = false;

    const tick = async () => {
      try {
        const { items, cursor } = await api.requests(serverUrl, roomId, reqCursorRef.current);
        if (stop) return;
        setConn("online");
        reqCursorRef.current = cursor;
        if (!primed) {
          primed = true; // ignore requests queued before this page was open
          return;
        }
        for (const item of items) {
          const player = playerRef.current;
          if (!player) break;
          // spam guard: skip only identical repeats within the throttle window
          const now = Date.now();
          const spam =
            item.action === lastActionRef.current.action &&
            item.amount === lastActionRef.current.amount &&
            now - lastActionRef.current.at < REQUEST_THROTTLE_MS;
          if (spam) continue;
          lastActionRef.current = { action: item.action, amount: item.amount, at: now };

          if (item.action === "play") {
            const p = player.play();
            p?.catch(() => {});
            pushToast("▶️ Your co-watcher pressed play", "info");
          } else if (item.action === "pause") {
            player.pause();
            pushToast("⏸️ Your co-watcher pressed pause", "info");
          } else if (item.action === "seek") {
            const amount = Number(item.amount) || 0;
            const target = Math.max(0, player.currentTime() + amount);
            player.currentTime(target);
            pushToast(amount >= 0 ? `⏩ Skipped +${amount}s for them` : `⏪ Skipped ${amount}s for them`, "info");
          }
        }
      } catch (e) {
        if (!stop && e.offline) setConn("offline");
      }
    };

    const iv = setInterval(tick, HOST_REQUEST_POLL_MS);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [phase, isHost, serverUrl, roomId, pushToast]);

  // ==========================================================================
  // 5. Player wiring
  // ==========================================================================
  const handlePlayerReady = useCallback(
    (player) => {
      playerRef.current = player;
      setPlayerBump((b) => b + 1);

      // local volume pref applies to everyone's own player
      try {
        player.volume(volume);
        player.muted(muted);
      } catch {}

      player.on("error", () => {
        const file = roomRef.current?.file || "";
        const hint = isRiskyVideo(file)
          ? ` .${(file.match(/\.([a-z0-9]+)$/i)?.[1] || "").toUpperCase()} files can't play in browsers — convert it to MP4 with HandBrake (free).`
          : " MP4 (H.264 + AAC) plays everywhere — see README for a free converter.";
        pushToast("Playback error." + hint, "error");
      });

      if (!isHost) return;
      player.on("play", () => setHostPlaying(true));
      player.on("pause", () => setHostPlaying(false));
      player.on("ended", () => setHostPlaying(false));
      const onActivity = () => pushNow();
      player.on("play", onActivity);
      player.on("pause", () => {
        if (!player.ended()) onActivity();
      });
      player.on("ended", onActivity);
      player.on("seeked", onActivity);
    },
    [isHost, pushNow, volume, muted, pushToast]
  );

  // Save the host's exact position if they close/refresh the tab.
  useEffect(() => {
    if (phase !== "ready" || !isHost || !serverUrl) return;
    const onPageHide = () => {
      const player = playerRef.current;
      if (!player || !roomRef.current?.file) return;
      pushStateKeepalive(serverUrl, roomId, player.currentTime(), !player.paused() && !player.ended());
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [phase, isHost, serverUrl, roomId]);

  // ==========================================================================
  // 6. Subtitle tracks — (re)attach when the room's subtitle changes
  // ==========================================================================
  useEffect(() => {
    if (!playerBump) return;
    const player = playerRef.current;
    if (!player) return;

    // clear any previous tracks (movie swap or subtitle change)
    try {
      const existing = player.remoteTextTracks?.() || [];
      for (let i = existing.length - 1; i >= 0; i--) {
        player.removeRemoteTextTrack(existing[i]);
      }
    } catch {}
    subTrackRef.current = null;
    setSubOffset(0);

    if (!room?.subtitle || !videoSrc) return;

    const src = `${serverUrlRef.current}/media/${roomId}/${encodeURIComponent(room.subtitle)}`;
    let track;
    try {
      track = player.addRemoteTextTrack(
        {
          kind: "subtitles",
          src,
          srclang: /\.([a-z]{2,3})\./i.exec(room.subtitle)?.[1]?.toLowerCase() || "en",
          label: prettySubLabel(room.subtitle),
        },
        false
      );
    } catch {
      return;
    }
    subTrackRef.current = track;
    track.mode = "hidden";

    whenCuesReady(track).then(() => {
      if (subTrackRef.current === track) {
        track.mode = ccOn ? "showing" : "hidden";
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerBump, videoSrc, room?.subtitle, roomId]);

  // CC on/off (local)
  function toggleCc() {
    const next = !ccOn;
    setCcOn(next);
    window.localStorage.setItem(LS_CC_ON, next ? "1" : "0");
    const track = subTrackRef.current;
    if (track) track.mode = next ? "showing" : "hidden";
    else if (next && !room?.subtitle) pushToast("No subtitle file is loaded — the host can add one (same name as the movie).", "info");
  }

  // Subtitle sync offset (local)
  function nudgeSubtitles(dir) {
    const track = subTrackRef.current;
    if (!track || !track.cues || !track.cues.length) {
      pushToast("Subtitles are still loading — try again in a second.", "info");
      return;
    }
    const delta = dir * SUBTITLE_OFFSET_STEP_S;
    if (shiftCues(track, delta)) {
      setSubOffset((o) => Math.round((o + delta) * 10) / 10);
    }
  }

  // ==========================================================================
  // 7. Volume (local)
  // ==========================================================================
  function changeVolume(v) {
    setVolume(v);
    setMuted(v === 0 ? true : muted && v === 0);
    if (v > 0 && muted) setMuted(false);
    window.localStorage.setItem(LS_VOLUME, String(v));
    const p = playerRef.current;
    try {
      if (p) {
        p.volume(v);
        p.muted(v === 0 ? true : muted && v === 0);
      }
    } catch {}
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try {
      playerRef.current?.muted(next);
    } catch {}
  }

  // ==========================================================================
  // 8. Seeks + requests
  // ==========================================================================
  function seekLocal(delta) {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime(Math.max(0, player.currentTime() + delta));
    // 'seeked' event fires -> pushNow() runs automatically
  }

  function sendRequest(action, amount) {
    const s = serverUrlRef.current;
    if (!s) return;
    api
      .sendRequest(s, roomId, action, amount)
      .catch(() => {
        setConn("offline");
        pushToast("Couldn't reach the host device — try again.", "error");
      });
  }

  // ==========================================================================
  // 9. Invite link + misc
  // ==========================================================================
  useEffect(() => {
    if (!isHost) return;
    setInviteUrl(
      serverUrl
        ? `${window.location.origin}/room/${roomId}?s=${encodeURIComponent(serverUrl)}`
        : ""
    );
  }, [isHost, serverUrl, roomId]);

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = inviteUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function toggleFullscreen() {
    const player = playerRef.current;
    if (!player) return;
    if (player.isFullscreen()) player.exitFullscreen();
    else player.requestFullscreen();
  }

  function togglePlay() {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused()) {
      Promise.resolve(player.play()).catch(() =>
        pushToast(
          "The browser refused to start this file — check Diagnostics below. Usually HEVC/H.265 → re-encode once with HandBrake.",
          "error"
        )
      );
    } else {
      player.pause();
    }
  }

  // ---- derived UI state -------------------------------------------------------
  const hasMovie = Boolean(room?.file) && Boolean(videoSrc);
  const riskyFile = isRiskyVideo(room?.file);
  const riskyExt = (room?.file?.match(/\.([a-z0-9]+)$/i)?.[1] || "?").toUpperCase();
  const hostOnline = room?.host_online === true;
  const guestPlaying = (room?.is_playing && hostOnline) === true;
  const hasSubtitles = Boolean(room?.subtitle);

  const syncLabel =
    drift === null
      ? { text: "Syncing…", tone: "text-slate-400 bg-night-700/60 border-transparent" }
      : Math.abs(drift) <= SOFT_DRIFT_S
        ? { text: `In sync · Δ ${Math.abs(drift).toFixed(2)}s`, tone: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30" }
        : Math.abs(drift) <= SYNC_TOLERANCE_S
          ? { text: `Catching up · Δ ${Math.abs(drift).toFixed(2)}s`, tone: "text-amber-300 bg-amber-500/10 border-amber-500/30" }
          : { text: "Jumping to host time…", tone: "text-sky-300 bg-sky-500/10 border-sky-500/30" };

  const btn =
    "rounded-xl border border-night-600 px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-night-700 active:scale-[0.98]";

  // ==========================================================================
  // Render
  // ==========================================================================
  if (phase === "booting") {
    return (
      <Center>
        <BigSpinner />
        <p className="mt-4 text-slate-400">
          Opening room <span className="font-mono font-bold text-white">{roomId}</span>…
        </p>
      </Center>
    );
  }

  if (phase === "error") {
    return (
      <Center>
        <div className="w-full max-w-md rounded-2xl border border-night-600 bg-night-800/60 p-8 text-center">
          <div className="text-4xl">🎞️💔</div>
          <h1 className="mt-3 text-xl font-bold text-white">{fatal?.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{fatal?.detail}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/"
              className="rounded-xl bg-glow-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-glow-500"
            >
              ← Back home
            </Link>
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl border border-night-600 px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-night-700"
            >
              Try again
            </button>
          </div>
        </div>
      </Center>
    );
  }

  const showPlayer = hasMovie && !pickingFile;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Toasts items={toasts} />

      {/* ---------- Header ---------- */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xl font-black tracking-tight">
            <span className="text-white">Movie</span>
            <span className="bg-gradient-to-r from-glow-400 to-glow-600 bg-clip-text text-transparent">
              watch
            </span>
          </Link>
          <span className="rounded-lg border border-glow-500/40 bg-glow-500/10 px-3 py-1 font-mono text-sm font-bold tracking-[0.25em] text-glow-300">
            {roomId}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isHost ? (
            <Pill tone="violet">🎬 You are the host</Pill>
          ) : (
            <Pill tone={hostOnline ? "green" : "amber"}>
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                  hostOnline ? "animate-pulse bg-emerald-400" : "bg-amber-400"
                }`}
              />
              {hostOnline ? "Host connected" : "Waiting for host…"}
            </Pill>
          )}
          <Pill tone={conn === "online" ? "green" : conn === "offline" ? "red" : "amber"}>
            {conn === "online" ? "Device: online" : conn === "offline" ? "Device: offline" : "Connecting…"}
          </Pill>
          {hasMovie && (
            <Pill tone={mediaCheck === null ? "amber" : mediaCheck.ok ? "green" : "red"}>
              {mediaCheck === null
                ? "Media: testing…"
                : mediaCheck.ok
                  ? `Media: OK · ${mediaCheck.ms}ms`
                  : "Media: FAIL"}
            </Pill>
          )}
          {isHost && inviteUrl && (
            <button
              onClick={copyInvite}
              className="rounded-lg border border-night-600 bg-night-800 px-3.5 py-1.5 text-sm font-semibold text-slate-200 transition hover:border-glow-500/50 hover:bg-night-700"
            >
              {copied ? "✓ Link copied!" : "🔗 Copy invite link"}
            </button>
          )}
        </div>
      </header>

      {conn === "offline" && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          ⚡ Can&apos;t reach the host device right now — retrying automatically. Check that the
          two windows (moviewatch.py + tunnel) are still running on the host&apos;s PC.
        </div>
      )}

      {hasMovie && riskyFile && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {isHost ? (
            <>
              <b>⚠️ Heads up:</b> <b>.{riskyExt}</b> files (like this one) can&apos;t be played by
              browsers — that&apos;s why the player hangs. Convert it once with the free app{" "}
              <a
                href="https://handbrake.fr"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline decoration-amber-400/60"
              >
                HandBrake
              </a>
              : open the file → preset <b>“Fast 1080p30”</b> → tick <b>“Web Optimized”</b> →
              Start Encode (saves a .mp4). Then press <b>♻️ Change movie</b> and pick the new
              MP4 — your co-watcher streams whatever you pick.
            </>
          ) : (
            <>
              <b>⚠️ Heads up:</b> this movie is a <b>.{riskyExt}</b> file, which browsers
              can&apos;t play. Ask the host to convert it to MP4 (free app: HandBrake) and pick
              it again — then it will play for both of you.
            </>
          )}
        </div>
      )}

      {/* ---------- Main area ---------- */}
      {isHost && !serverUrl ? (
        <DeviceConnect
          roomId={roomId}
          onConnected={(url) => {
            window.localStorage.setItem(LS_HOST_SERVER(roomId), url);
            setServerUrl(url);
            setConn("online");
            pushToast("✅ Device connected — now pick a movie below.", "success");
          }}
        />
      ) : showPlayer ? (
        <VideoPlayer
          key={videoSrc}
          src={videoSrc}
          isHost={isHost}
          initialTime={initialTimeRef.current}
          onReady={handlePlayerReady}
        />
      ) : isHost && serverUrl ? (
        <FilePicker
          serverUrl={serverUrl}
          roomId={roomId}
          currentFile={room?.file || null}
          onPicked={() => {
            setPickingFile(false);
            pushToast("🎬 Movie loaded — press play when you're both ready!", "success");
          }}
          onCancel={room?.file ? () => setPickingFile(false) : null}
        />
      ) : (
        <div className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-xl border border-night-600 bg-night-800/40 p-8 text-center">
          <BigSpinner />
          <h3 className="mt-5 text-lg font-bold text-white">
            Waiting for the host to pick a movie…
          </h3>
          <p className="mt-1 max-w-sm text-sm text-slate-400">
            Keep this tab open — the movie will appear and start following the host
            automatically.
          </p>
        </div>
      )}

      {/* ---------- Control bar ---------- */}
      {showPlayer && (
        <section className="mt-4 rounded-xl border border-night-600 bg-night-800/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">
                📽️ {room?.file ? shortName(room.file) : "Now playing"}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {isHost
                  ? `You control playback · ${formatTime(nowAt)} · streaming from your device`
                  : "🔒 Playback follows the host — buttons send friendly requests"}
              </p>
            </div>
            {!isHost && (
              <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${syncLabel.tone}`}>
                {syncLabel.text}
              </span>
            )}
          </div>

          {/* ============ HOST controls (direct) ============ */}
          {isHost && (
            <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={togglePlay}
                className="rounded-xl bg-gradient-to-r from-glow-600 to-glow-500 px-5 py-2.5 text-sm font-bold text-white shadow-glow transition hover:brightness-110 active:scale-[0.98]"
                title="Play / pause"
              >
                {hostPlaying ? "⏸ Pause" : "▶️ Play"}
              </button>
              <button onClick={() => seekLocal(-SEEK_STEP_S)} className={btn} title="Back 10 seconds">
                ⏪ {SEEK_STEP_S}s
              </button>
              <button onClick={() => seekLocal(SEEK_STEP_S)} className={btn} title="Forward 10 seconds">
                ⏩ {SEEK_STEP_S}s
              </button>

              <label className="flex items-center gap-2 rounded-xl border border-night-600 bg-night-900/60 px-3 py-2 text-sm">
                <span className="text-slate-400">CC</span>
                <select
                  value={room?.subtitle || ""}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    api
                      .setSubtitle(serverUrl, roomId, val)
                      .then(() => {
                        setRoom((prev) => ({ ...(prev || {}), subtitle: val }));
                        pushToast(val ? `🗣 Subtitles: ${prettySubLabel(val)}` : "Subtitles off (for everyone)", "success");
                      })
                      .catch((err) => pushToast(err.offline ? "Device unreachable." : err.message, "error"));
                  }}
                  className="max-w-44 truncate bg-transparent text-sm font-semibold text-white outline-none"
                >
                  <option value="" className="bg-night-900">Off</option>
                  {subFiles.map((sf) => (
                    <option key={sf.name} value={sf.name} className="bg-night-900">
                      {prettySubLabel(sf.name)}
                    </option>
                  ))}
                </select>
              </label>

              <button onClick={() => setPickingFile(true)} className={btn}>
                ♻️ Change movie
              </button>
              <button onClick={toggleFullscreen} className={btn} title="Fullscreen">
                ⛶
              </button>
              <button onClick={copyDirectLink} className={btn} title="Copy the video's direct URL — open it in a NEW browser tab to test whether the file itself streams">
                🧪 Copy direct link
              </button>
            </div>
            <DiagnosticsLine mediaCheck={mediaCheck} codecs={codecs.current} />
            </>
          )}

          {/* ============ GUEST controls (requests + local prefs) ============ */}
          {!isHost && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => sendRequest(guestPlaying ? "pause" : "play")}
                  className="rounded-xl bg-gradient-to-r from-glow-600 to-glow-500 px-5 py-2.5 text-sm font-bold text-white shadow-glow transition hover:brightness-110 active:scale-[0.98]"
                >
                  {guestPlaying ? "⏸ Request pause" : "▶️ Request play"}
                </button>
                <button onClick={() => sendRequest("seek", -SEEK_STEP_S)} className={btn} title={`Ask host to go back ${SEEK_STEP_S}s`}>
                  ⏪ {SEEK_STEP_S}s
                </button>
                <button onClick={() => sendRequest("seek", SEEK_STEP_S)} className={btn} title={`Ask host to skip ${SEEK_STEP_S}s`}>
                  ⏩ {SEEK_STEP_S}s
                </button>
                <button onClick={toggleFullscreen} className={btn} title="Fullscreen">
                  ⛶
                </button>
                {needUnmute && (
                  <button
                    onClick={() => {
                      const player = playerRef.current;
                      if (!player) return;
                      player.muted(false);
                      setMuted(false);
                      setNeedUnmute(false);
                    }}
                    className="animate-pulse rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm font-bold text-amber-300"
                  >
                    🔇 Playing muted — tap to unmute
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* subtitle on/off + sync — LOCAL to each viewer */}
                <button
                  onClick={toggleCc}
                  className={`${btn} ${ccOn ? "!border-glow-500/60 !bg-glow-500/10 !text-glow-200" : ""}`}
                  title="Subtitles on/off (only for you)"
                >
                  CC {ccOn ? "On" : "Off"}
                </button>
                <div
                  className={`flex items-center gap-1 rounded-xl border border-night-600 bg-night-900/60 px-2 py-1.5 ${
                    hasSubtitles && ccOn ? "" : "opacity-40"
                  }`}
                  title="Subtitle sync: nudge earlier/later (only for you)"
                >
                  <span className="px-1 text-xs text-slate-400">Sync</span>
                  <button onClick={() => nudgeSubtitles(-1)} disabled={!hasSubtitles} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-200 hover:bg-night-700 disabled:cursor-not-allowed">
                    ⏪ {SUBTITLE_OFFSET_STEP_S}s
                  </button>
                  <span className="w-12 text-center font-mono text-xs text-glow-300">
                    {subOffset > 0 ? `+${subOffset}` : subOffset}s
                  </span>
                  <button onClick={() => nudgeSubtitles(1)} disabled={!hasSubtitles} className="rounded-lg px-2 py-1 text-sm font-bold text-slate-200 hover:bg-night-700 disabled:cursor-not-allowed">
                    ⏩ {SUBTITLE_OFFSET_STEP_S}s
                  </button>
                </div>

                {/* volume — LOCAL by design */}
                <VolumeControl
                  volume={volume}
                  muted={muted}
                  onVolume={changeVolume}
                  onToggleMute={toggleMute}
                />
              </div>

              <p className="text-[11px] text-slate-500">
                Volume &amp; subtitle tweaks are only on your screen — the other side is unaffected.
              </p>
              <DiagnosticsLine mediaCheck={mediaCheck} codecs={codecs.current} />
            </div>
          )}
        </section>
      )}

      <p className="mt-6 text-center text-xs text-slate-600">
        {isHost
          ? "Tip: pause before closing this tab, and stop your PC from sleeping during the movie."
          : "Sit back 🍿 — the host controls the show. Your view resyncs automatically."}
      </p>
    </main>
  );
}

/* ------------------------------ tiny UI atoms ----------------------------- */

function Center({ children }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  );
}

function BigSpinner() {
  return (
    <svg className="h-9 w-9 animate-spin text-glow-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Mark({ ok }) {
  return ok ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>;
}

function DiagnosticsLine({ mediaCheck, codecs }) {
  const hevcMissing = codecs && codecs.hevc === "";
  const h264Missing = codecs && codecs.h264 === "";
  return (
    <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-500">
      <p>
        <span className="font-semibold text-slate-400">Diagnostics</span> · Media path:{" "}
        {mediaCheck === null ? (
          "testing…"
        ) : mediaCheck.ok ? (
          <span className="text-emerald-400">reaching your browser OK ({mediaCheck.ms}ms)</span>
        ) : (
          <span className="text-red-400">
            FAILED ({mediaCheck.reason}) — tunnel/server path problem, not the player
          </span>
        )}
        {codecs && (
          <>
            {" · Codecs: H.264 "} <Mark ok={codecs.h264 !== ""} /> {", HEVC/H.265 "}{" "}
            <Mark ok={codecs.hevc !== ""} /> {", WebM/VP9 "} <Mark ok={codecs.vp9 !== ""} />
          </>
        )}
      </p>
      {mediaCheck?.ok && hevcMissing && (
        <p className="text-amber-400/90">
          Your browser can&apos;t decode <b>HEVC/H.265</b> — downloads from Dailymotion/phones are
          often HEVC even when named .mp4 (symptom: endless loading, no picture). Fix once with
          HandBrake → “Fast 1080p30” → tick “Web Optimized” → pick the new .mp4.
        </p>
      )}
      {mediaCheck?.ok && h264Missing && (
        <p className="text-amber-400/90">This browser can&apos;t decode even H.264 — try Chrome/Edge/Firefox.</p>
      )}
    </div>
  );
}

const PILL_TONES = {
  violet: "border-glow-500/40 bg-glow-500/10 text-glow-300",
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  red: "border-red-500/40 bg-red-500/10 text-red-300",
};

function Pill({ tone = "violet", children }) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
