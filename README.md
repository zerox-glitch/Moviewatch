# 🍿 Moviewatch

**Watch a movie together, in perfect sync, streaming the movie straight off your
own computer.**

- **Your co-watcher does nothing but open the link.** No installs, no accounts.
- **Nothing is uploaded, ever.** A 4 GB movie works exactly like a 400 MB one.
- **Full controls**: play/pause, ±10s seek, subtitles (on/off + sync offset per
  person), volume (per person), fullscreen.
- **One Python file** does all the work on your PC. No pip installs.

The app on Vercel is just the remote control; the movie streams from your disk
through a tunnel.

---

## Part 1 — One-time setup (~10 minutes)

### 1. Install Python (once)

[python.org/downloads](https://www.python.org/downloads/) → run the installer →
**tick “Add python.exe to PATH”** on the first screen → Install. (The Microsoft
Store version works too.)

### 2. Install cloudflared (once)

Windows: open **PowerShell** and run:

```powershell
winget install --id Cloudflare.cloudflared
```

(or download the .exe from [Cloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
Mac: `brew install cloudflared`.

### 3. Download moviewatch.py (once)

Grab [`server/moviewatch.py`](server/moviewatch.py) — **one file**. Save it
anywhere: Desktop, Downloads, even inside your movies folder.

> Windows tip: there's also
> [`server/start-moviewatch.bat`](server/start-moviewatch.bat) — put it next to
> moviewatch.py and use it if double-clicking the .py ever misbehaves. It shows
> errors instead of silently closing.

### 4. Deploy the website (once)

Push this repo to GitHub → [vercel.com](https://vercel.com) → **Add New… →
Project** → import → Framework Preset **Next.js** (already pinned in
`vercel.json`) → no environment variables → **Deploy**. You get
`yourapp.vercel.app` forever.

---

## Part 2 — Movie night (every time)

**Step A — start the server on your PC.**
Double-click `moviewatch.py` and pick your movies folder in the dialog. A black
window opens — **that window is the server; leave it open.** It tells you how
many videos it found. (Equivalent in a terminal:
`python moviewatch.py --dir "C:\Users\you\Movies"`.)

**Step B — give it a public address (the tunnel).**
Open a second window (PowerShell) and run:

```powershell
cloudflared tunnel --url http://localhost:7777
```

It prints an address like `https://example-words-1234.trycloudflare.com`.

**Step C — set up the room in the browser.**

1. `yourapp.vercel.app` → **🍿 Create Room (Host)**.
2. Paste the tunnel address → **Connect** (your PC remembers it).
3. Pick the movie. A subtitle file next to it with the same name
   (`Movie.mp4` + `Movie.ur.srt`) attaches automatically.
4. **🔗 Copy invite link** → send it → press play. 🍿

Your co-watcher opens the link and watches. That's their whole job.

---

## Tunnel links: tonight vs. permanent

### ✅ “A link that works for a couple of hours” — the quick tunnel (default)

The `cloudflared tunnel --url http://localhost:7777` address **stays valid as
long as its window stays open** — easily a whole movie night, or a whole day if
you just leave it. No account, no limits that matter here. Two things to know:

- Close the tunnel window (or it crashes / PC sleeps) → the link dies. Run the
  command again → **it prints a NEW address** → paste the new one into your
  room page and re-send the invite link.
- So the ritual is: 2 windows open → paste address (first time each session) →
  watch.

### 🏠 “A link that never changes” — Cloudflare named tunnel (recommended once you're hooked)

Free from Cloudflare; the only cost is owning a **domain** (~$10/year, e.g. at
Cloudflare, Namecheap or Porkbun — or use one you already have). Setup once,
~15 minutes, then it **auto-starts with your PC** and you never think about it
again. After this, movie night = only Step A above (double-click moviewatch.py)
— no tunnel window, no pasting addresses, invite link works forever.

1. **Add your domain to Cloudflare** (free plan is enough):
   dash.cloudflare.com → **Add a site** → follow the wizard (it moves the
   domain's DNS to Cloudflare; you'll change 2 nameservers at your registrar —
   Cloudflare shows you exactly which).
2. In the dashboard, go to **Zero Trust** (left sidebar) → it may ask you to
   choose a team name on the free plan → then **Networks → Tunnels**.
3. **Create a tunnel** → choose **Cloudflared** → name it `moviewatch` → Save.
4. On the “Install and run a connector” page choose **Windows** and copy the
   one-line command it shows, which looks like:
   `cloudflared service install eyJh...long-token...`
   Run it in **PowerShell as Administrator**. This installs cloudflared as a
   Windows **service** — it starts automatically whenever your PC is on. No
   tunnel window needed, ever again.
5. On the same page, under **Public Hostname**, add:
   - Subdomain: `movies` · Domain: `yourdomain.com`
   - Service Type: `HTTP` · URL: `localhost:7777`
   → Save hostname.
6. Done — `https://movies.yourdomain.com` is your **permanent** address. Paste
   it into your room page once; your invite link never changes.

(There's a command-line way to do all this too — `cloudflared tunnel login`,
`cloudflared tunnel create`, `cloudflared tunnel route dns` — the dashboard
way above is the click-through version of the same thing.)

### ❌ Why not ngrok?

ngrok's free plan gives a nice permanent `name.ngrok-free.app` domain — but it
caps data transfer at **1 GB per month** (and ~20k requests). One movie night
streams 2–4 GB, so it would cut out almost immediately. It's fine for testing;
don't use it for movies. (Its paid plan removes the cap — Cloudflare's named
tunnel is free, so start there.)

---

## Subtitles

Drop a `.srt` (or `.vtt`) next to the movie with the same name
(`Movie.2023.mp4` + `Movie.2023.ur.srt`) — attached automatically. Both of you
get **CC on/off** and a **sync nudge (±0.5s per tap)** for the classic
“subtitles run 2 seconds early” problem — per person, without desyncing video.

## Controls

| Control | Host | Guest |
|---|---|---|
| Play / Pause | direct | sends a request (host gets a toast) |
| Seek ±10s | direct | sends a request |
| Pick movie / subtitle track | ✓ | follows automatically |
| Subtitles on/off + sync offset | ✓ | ✓ local only |
| Volume / mute | in player | ✓ local only |
| Fullscreen | ✓ | ✓ |

Sync: host pushes position ~1×/sec (instantly on play/pause/seek); guest
reconciles every 400 ms — jumps only if >0.5 s off, gentle rate-nudge between
0.15–0.5 s. Host device gone → guest freezes (like a pause) and resumes
automatically. Position saves to `moviewatch-state.json` next to the script, so
refreshes/restarts resume cleanly.

---

## Troubleshooting

**“A black window flashes and disappears fast”** — the #1 cause:

1. **You're running an older copy of moviewatch.py.** Early versions closed
   instantly on any error, so you never saw the reason. **Re-download
   `server/moviewatch.py`** (link above) — the current version *never* closes
   silently: every error stays on screen and it waits for you to press Enter.
   When it starts correctly you'll see the big
   `MOVIEWATCH media server v3.x` banner and it tells you how many videos it
   found.
2. Then prefer **`start-moviewatch.bat`** for launching: right-clicking
   .py files can be hijacked by bad "Open with" associations (Notepad/VS Code)
   or an old Python 2 — the .bat picks the right Python (`py -3`), detects the
   fake "Microsoft Store python", and keeps all messages visible.
3. If it *still* flashes: open PowerShell in that folder and run
   `python moviewatch.py` — read what it says (it now stays open either way).

Also: the folder-picker dialog can open *behind* other windows — check the
taskbar. The script never needs to be “in” the movies folder: if you cancel
the picker, it serves the folder it's in (if that folder has videos).

**“Can't reach that address”** → The tunnel window closed or restarted (new
address). Copy the fresh one and press Connect again.

**Guest sees “Device: offline”** → One of the two windows on your PC closed /
PC slept. Reopen them; the room page reconnects automatically once you press
Connect again with the fresh address.

**Stutters / buffering** → Host upload bandwidth (fast.com). Convert with
HandBrake “Fast 1080p30” — halves the bitrate, doubles smoothness.

**“Room not registered”** → The host must open their room link and press
Connect first (only the host's browser registers the room).

**No sound / green screen** → Codec issue. Re-encode MP4 (H.264 + AAC).

**Port 7777 busy** → `python moviewatch.py --port 7778` and tunnel to that port.

**Movie plays with no subtitles** → The `.srt`/`.vtt` must be in the same
folder with a matching name — or the host can pick it in the CC dropdown.

---

## Vercel: fixing `404 NOT_FOUND` on your domain

That error means **the production domain has no successful production
deployment attached** — almost always a *branch* issue, because the working
code lives on the `arena/01a07e2b-moviewatch` branch, while Vercel's
Production Branch defaults to `main` (which is empty in this repo).

**Pick ONE of these fixes:**

**Fix A (fastest): point production at the right branch**

1. Vercel dashboard → your project → **Settings → Git → Production Branch**.
2. Change it from `main` to `arena/01a07e2b-moviewatch` → **Save**.
3. **Deployments** tab → latest deployment → **⋯ → Redeploy** (Production
   build).
4. Visit the plain domain from **Settings → Domains**
   (`whatever.vercel.app`) — it should render now.

**Fix B (cleanest long-term): merge the branch into `main`**

1. GitHub → your repo → **Pull requests → New pull request**.
2. Set **base: `main`** ← **compare: `arena/01a07e2b-moviewatch`**.
3. **Create pull request → Merge**. Main now has the app; Vercel's default
   `main` production branch builds it on the next deploy (or trigger a
   Redeploy).

Note: `https://…vercel.app` **is** the production domain. URLs like
`project-git-branch-user.vercel.app` are *preview* deployments — they're
normal to exist alongside; just don't judge production by them.

## FAQ

**Who can access my movie?** Only people holding the invite link (room code +
your tunnel address). The server refuses files for unregistered room codes.
Private-party safe; don't post invite links publicly.

**Does the tunnel cost anything / is it allowed?** Cloudflare quick tunnels are
free and account-less — perfect for personal movie nights. For heavy regular
use, the named tunnel (above) is Cloudflare's intended, free way.

**Internet drops mid-movie?** Guest freezes and auto-resumes; sync survives.

**Movie files** — **MP4 (H.264 + AAC)** plays everywhere. Convert free with
[HandBrake](https://handbrake.fr) → “Fast 1080p30” → tick **Web Optimized**.

---

## Project structure

```
app/            landing + room pages (Next.js 14, Tailwind, Video.js)
components/     RoomClient (sync engine), DeviceConnect, FilePicker,
                VideoPlayer, VolumeControl, Toasts
lib/            server-api, invite links, subtitles (offset engine), constants
server/
  moviewatch.py        ← the whole media server (stdlib only, double-clickable)
  start-moviewatch.bat ← Windows helper (keeps errors visible)
```

Tuning knobs live in `lib/constants.js` (polling cadence, sync tolerances,
seek step, subtitle step).
