"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { randomRoomCode, parseInviteLink } from "@/lib/invite";

const STEPS = [
  {
    icon: "🎬",
    title: "Create a room",
    body: "Tap “Create Room” to get your private 6-character code — you're the host.",
  },
  {
    icon: "💻",
    title: "Connect your PC",
    body: "Run the tiny media server on your computer and expose it with a free Cloudflare Tunnel. Your movie never leaves your disk — even 4 GB files play.",
  },
  {
    icon: "💌",
    title: "Share the link",
    body: "Send the invite to your co-watcher. They stream the movie straight from your machine and follow your play, pause and seek in real time.",
  },
];

export default function Home() {
  const router = useRouter();
  const [joinValue, setJoinValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // A code is generated on demand so refreshing never burns one.
  const [nextCode, setNextCode] = useState(null);

  useEffect(() => {
    if (creating && nextCode) router.push(`/room/${nextCode}?role=host`);
  }, [creating, nextCode, router]);

  async function handleCreate() {
    setError(null);
    setCreating(true);
    // Give the router a beat so the button state paints before we leave.
    setNextCode(randomRoomCode());
  }

  function handleJoin(e) {
    e.preventDefault();
    setError(null);
    const parsed = parseInviteLink(joinValue);
    if (parsed) {
      router.push(`/room/${parsed.code}?s=${encodeURIComponent(parsed.serverUrl)}`);
      return;
    }
    if (/^[A-Za-z0-9]{6}$/.test(joinValue.trim())) {
      setError(
        "A code alone isn't enough — the app also needs the host's device address. Paste the full invite link you were sent (it starts with https:// and contains “/room/”)."
      );
      return;
    }
    setError("Paste the full invite link the host sent you.");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:py-14">
      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-glow-500/30 bg-glow-500/10 px-4 py-1.5 text-xs font-medium tracking-wide text-glow-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-glow-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-glow-400" />
          </span>
          STREAMS FROM YOUR OWN PC · NO UPLOADS · IN PERFECT SYNC
        </div>

        <h1 className="bg-gradient-to-br from-white via-glow-300 to-glow-500 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-7xl">
          Moviewatch
        </h1>
        <p className="mt-4 max-w-xl text-balance text-lg text-slate-400">
          Movie night, perfectly in sync. Your movie stays on your computer — your co-watcher
          streams it from you and follows every play, pause and seek live.
        </p>

        {/* Actions */}
        <div className="mt-10 w-full max-w-lg space-y-3">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="group relative w-full rounded-2xl bg-gradient-to-r from-glow-600 to-glow-500 px-6 py-4 text-lg font-bold text-white shadow-glow transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? (
              <span className="inline-flex items-center gap-3">
                <Spinner /> Opening your room…
              </span>
            ) : (
              <>🍿 Create Room (Host)</>
            )}
          </button>

          <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-widest text-slate-600">
            <span className="h-px flex-1 bg-night-600" />
            or join with an invite link
            <span className="h-px flex-1 bg-night-600" />
          </div>

          <form onSubmit={handleJoin} className="flex gap-2">
            <input
              value={joinValue}
              onChange={(e) => setJoinValue(e.target.value)}
              placeholder="Paste invite link…"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="w-full flex-1 rounded-2xl border border-night-600 bg-night-800/80 px-5 py-4 text-sm text-white placeholder:text-slate-600 focus:border-glow-500 focus:outline-none focus:ring-2 focus:ring-glow-500/40"
            />
            <button
              type="submit"
              className="rounded-2xl border border-night-600 bg-night-800 px-6 py-4 font-semibold text-slate-200 transition hover:border-glow-500/50 hover:bg-night-700 active:scale-[0.99]"
            >
              Join →
            </button>
          </form>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* How it works */}
      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="rounded-2xl border border-night-600 bg-night-800/50 p-5 backdrop-blur"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{s.icon}</span>
              <span className="text-xs font-bold uppercase tracking-widest text-glow-400">
                Step {i + 1}
              </span>
            </div>
            <h3 className="mt-3 font-bold text-white">{s.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{s.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-12 text-center text-xs text-slate-600">
        No accounts · no uploads · no database — the app on Vercel is just the remote control;
        the movie lives on the host's device
      </footer>
    </main>
  );
}

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
