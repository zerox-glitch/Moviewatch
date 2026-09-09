"use client";

// ============================================================================
// Video.js wrapper.
//
// - video.js loads client-side via dynamic import (it needs `window`).
// - The stylesheet below is what makes the player LOOK like a player — without
//   it the controls render as a pile of unstyled text. It must be imported
//   alongside the player (App Router allows global CSS from node_modules).
// - Host  -> full native controls (play/pause/seek/volume in the control bar).
// - Guest -> controls stripped; sync is driven from RoomClient via onReady().
// - crossOrigin="anonymous" is required for the WebVTT subtitle tracks served
//   from the host's tunnel (different origin than the Vercel app) — the media
//   server replies with CORS headers, so "anonymous" is safe.
// ============================================================================

import "video.js/dist/video-js.css";

import { memo, useEffect, useRef, useState } from "react";
import { guessSourceType } from "@/lib/format";

function VideoPlayer({ src, isHost, initialTime = 0, onReady, className = "" }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [readyTick, setReadyTick] = useState(0); // bumps once the engine exists
  const onReadyRef = useRef(onReady);
  const initialTimeRef = useRef(initialTime);
  onReadyRef.current = onReady;
  initialTimeRef.current = initialTime;

  // ---- create the player once ---------------------------------------------
  useEffect(() => {
    let disposed = false;

    (async () => {
      const { default: videojs } = await import("video.js");
      if (disposed) return;
      const el = videoRef.current;
      if (!el) return;

      // Clean up any stray player left on this element (e.g. dev StrictMode).
      const existing = videojs.getPlayer(el);
      if (existing) existing.dispose();

      const player = videojs(el, {
        controls: isHost,
        preload: "auto",
        playsInline: true,
        responsive: true,
        fluid: true,
        userActions: {
          hotkeys: isHost,
          click: isHost,
          doubleClick: isHost,
        },
        controlBar: { pictureInPictureToggle: false },
        notSupportedMessage:
          "This browser can't play this file. MP4 (H.264 + AAC) plays everywhere — see the README for a free converter.",
        sources: [],
      });

      playerRef.current = player;
      onReadyRef.current?.(player);
      // The attach effect below must re-run even if `src` didn't change while
      // the engine was loading (cold cache): without this bump a component
      // mounted WITH a src would never attach it (endless black loading).
      setReadyTick((t) => t + 1);
    })();

    return () => {
      disposed = true;
      try {
        playerRef.current?.dispose();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };

    // The player is created once per mount; host/guest role never changes
    // while mounted (RoomClient only mounts the player after role check).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- attach / swap the source --------------------------------------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !src) return;

    player.src({ src, type: guessSourceType(src) });

    const onLoadedMetadata = () => {
      const start = initialTimeRef.current;
      try {
        const d = player.duration?.();
        // Saved position at/after the end (short clip, stale state) would sit
        // on a black ended frame where Play does nothing — restart instead.
        if (Number.isFinite(d) && d > 0 && start >= d - 0.5) {
          player.currentTime(0);
          return;
        }
      } catch {}
      if (start > 0.5 && Math.abs(player.currentTime() - start) > 0.5) {
        player.currentTime(start);
      }
    };
    player.one("loadedmetadata", onLoadedMetadata);
    return () => player.off("loadedmetadata", onLoadedMetadata);
  }, [src, readyTick]);

  return (
    <div
      className={`${isHost ? "" : "guest-mode"} relative w-full overflow-hidden rounded-xl bg-black ${className}`}
      onContextMenu={(e) => {
        if (!isHost) e.preventDefault();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} crossOrigin="anonymous" className="video-js vjs-big-play-centered" />
    </div>
  );
}

export default memo(VideoPlayer);
