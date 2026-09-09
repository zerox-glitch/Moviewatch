"use client";

// ============================================================================
// DeviceConnect — first-run panel for the HOST.
//
// The movie never leaves their PC: they run ONE python file next to their
// movies and expose it with a tunnel. This panel walks them through it and
// takes the tunnel URL.
// ============================================================================

import { useState } from "react";
import { api } from "@/lib/server-api";
import { normalizeServerUrl } from "@/lib/invite";

const WINDOWS = typeof navigator !== "undefined" && /win/i.test(navigator.platform || navigator.userAgent);

const PY_DOWNLOAD =
  "https://github.com/zerox-glitch/Moviewatch/raw/arena/01a07e2b-moviewatch/server/moviewatch.py";
const BAT_DOWNLOAD =
  "https://github.com/zerox-glitch/Moviewatch/raw/arena/01a07e2b-moviewatch/server/start-moviewatch.bat";

function Cmd({ children }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-night-600 bg-night-950 px-3 py-2">
      <code className="thin-scroll overflow-x-auto whitespace-nowrap font-mono text-[13px] text-glow-300">
        {children}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              typeof children === "string" ? children : children?.props?.children || ""
            );
          } catch {}
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded border border-night-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-400 hover:border-glow-500/50 hover:text-glow-300"
      >
        {copied ? "✓" : "copy"}
      </button>
    </span>
  );
}

export default function DeviceConnect({ roomId, onConnected }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("idle"); // idle | connecting | error
  const [error, setError] = useState(null);

  async function connect(e) {
    e.preventDefault();
    setError(null);
    const url = normalizeServerUrl(value);
    if (!url) {
      setError(
        "That doesn't look like the tunnel address. It should start with https:// — copy it from the tunnel window."
      );
      return;
    }
    setStatus("connecting");
    try {
      await api.health(url);
      await api.register(url, roomId);
      onConnected(url);
    } catch (err) {
      setStatus("error");
      setError(
        err.offline
          ? "Can't reach that address. Is the tunnel window still running, and did you copy the full https:// address?"
          : err.message
      );
    }
  }

  return (
    <div className="rounded-xl border border-night-600 bg-night-800/60 p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xl">💻</span>
        <h2 className="text-lg font-bold text-white">Connect your device</h2>
      </div>
      <p className="text-sm text-slate-400">
        Your movie streams straight from your PC — nothing is uploaded. One-time setup,
        about 10 minutes. Your co-watcher never has to install anything.
      </p>

      <ol className="mt-5 space-y-4 text-sm">
        <li className="rounded-lg border border-night-700 bg-night-900/50 p-4">
          <p className="font-semibold text-white">
            <span className="mr-2 rounded bg-glow-600 px-1.5 py-0.5 text-xs font-bold">1</span>
            Install the two free tools <span className="font-normal text-slate-400">(one-time)</span>
          </p>
          <ul className="mt-2 space-y-1.5 text-slate-400">
            <li>
              •{" "}
              <a
                href="https://www.python.org/downloads/"
                target="_blank"
                rel="noreferrer"
                className="text-glow-300 underline decoration-glow-500/40 hover:text-glow-200"
              >
                Python
              </a>{" "}
              {WINDOWS
                ? "— during install, tick “Add python.exe to PATH”. (The Microsoft Store version works too.)"
                : "— or `brew install python` on a Mac."}
            </li>
            <li>
              •{" "}
              <b>cloudflared</b> — {WINDOWS ? (
                <>
                  easiest: open <b>PowerShell</b> and run{" "}
                  <code className="rounded bg-black/30 px-1">winget install --id Cloudflare.cloudflared</code>{" "}
                  (or{" "}
                  <a
                    href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-glow-300 underline decoration-glow-500/40 hover:text-glow-200"
                  >
                    download it here
                  </a>
                  ).
                </>
              ) : (
                <>
                  <a
                    href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-glow-300 underline decoration-glow-500/40 hover:text-glow-200"
                  >
                    download it here
                  </a>{" "}
                  (or `brew install cloudflared` on a Mac).
                </>
              )}
            </li>
          </ul>
        </li>

        <li className="rounded-lg border border-night-700 bg-night-900/50 p-4">
          <p className="font-semibold text-white">
            <span className="mr-2 rounded bg-glow-600 px-1.5 py-0.5 text-xs font-bold">2</span>
            Download <b>both files</b> into the same folder
          </p>
          <ul className="mt-2 space-y-1 text-slate-400">
            <li>
              •{" "}
              <a
                href={PY_DOWNLOAD}
                target="_blank"
                rel="noreferrer"
                className="text-glow-300 underline decoration-glow-500/40 hover:text-glow-200"
              >
                moviewatch.py
              </a>{" "}
              — the server. Re-download if you grabbed it before:{" "}
              <b>older copies flash and close instantly</b>. The current one always shows
              <code className="mx-1 rounded bg-black/30 px-1">MOVIEWATCH media server v3.x</code> and
              waits for Enter before closing.
            </li>
            <li>
              •{" "}
              <a
                href={BAT_DOWNLOAD}
                target="_blank"
                rel="noreferrer"
                className="text-glow-300 underline decoration-glow-500/40 hover:text-glow-200"
              >
                start-moviewatch.bat
              </a>{" "}
              {WINDOWS ? (
                <>— <b>double-click this one</b> (not the .py). It handles Windows quirks and
                keeps every error message visible.</>
              ) : (
                <>— Windows helper (not needed on a Mac).</>
              )}
            </li>
          </ul>
          <p className="mt-2 text-slate-400">
            Put them anywhere (Desktop, or inside your movies folder). Launching opens a folder
            picker: choose your movies folder. A black window appears —{" "}
            <b>that window is the server, leave it open</b>. It tells you how many videos it
            found.
          </p>
          {WINDOWS && (
            <p className="mt-2 text-xs text-slate-500">
              Double-clicking moviewatch.py flashes a window and vanishes? That's Windows opening
              it wrongly — use start-moviewatch.bat instead. It never closes silently, and if
              Python is missing it tells you exactly what to install.
            </p>
          )}
          <div className="mt-2">
            <Cmd>
              python moviewatch.py --dir {WINDOWS ? '"C:\\Users\\you\\Movies"' : '"~/Movies"'}
            </Cmd>
          </div>
        </li>

        <li className="rounded-lg border border-night-700 bg-night-900/50 p-4">
          <p className="font-semibold text-white">
            <span className="mr-2 rounded bg-glow-600 px-1.5 py-0.5 text-xs font-bold">3</span>
            In a <em>second</em> window, start the tunnel
          </p>
          <div className="mt-2">
            <Cmd>cloudflared tunnel --url http://localhost:7777</Cmd>
          </div>
          <p className="mt-2 text-slate-400">
            It prints an address like{" "}
            <code className="rounded bg-black/30 px-1">https://xxxx.trycloudflare.com</code>. Put
            that below. <b>The address stays valid all evening</b> while that window is open — if
            you restart the tunnel it prints a new one (the README explains how to get a link
            that never changes).
          </p>
          <form onSubmit={connect} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://xxxx.trycloudflare.com"
              spellCheck={false}
              autoComplete="off"
              className="w-full flex-1 rounded-xl border border-night-600 bg-night-950 px-4 py-3 font-mono text-sm text-white placeholder:text-slate-600 focus:border-glow-500 focus:outline-none focus:ring-2 focus:ring-glow-500/40"
            />
            <button
              type="submit"
              disabled={status === "connecting"}
              className="rounded-xl bg-gradient-to-r from-glow-600 to-glow-500 px-6 py-3 font-bold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
            >
              {status === "connecting" ? "Connecting…" : "Connect →"}
            </button>
          </form>
          {error && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
              {error}
            </p>
          )}
        </li>
      </ol>
    </div>
  );
}
