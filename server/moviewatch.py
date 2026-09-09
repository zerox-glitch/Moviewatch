#!/usr/bin/env python3
# ============================================================================
#  MOVIEWATCH — one-file media + sync server
#  Put this next to your movies (anywhere, really) and run it. That's all.
#
#  What it does
#    · Streams your movie files (3-4 GB+) straight from your disk to your
#      co-watcher's browser, with seeking (HTTP Range requests).
#    · Keeps both players in sync (playback state + the guest's requests).
#    · Serves subtitles: .srt files are converted to WebVTT automatically,
#      with a sync offset available in the app.
#
#  Needs ONLY Python 3.8+ (no pip installs, nothing else).
#
#  Run it:
#      double-click this file                -> asks you for the movies folder
#    or:
#      python moviewatch.py --dir "C:\Movies"
#
#  Then expose it with a tunnel (see the banner this script prints, or the
#  app's README). Keep this window open during movie night.
# ============================================================================

import argparse
import json
import os
import re
import socketserver
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler

VERSION = "3.0.0"

VIDEO_EXTS = {".mp4", ".m4v", ".webm", ".mkv", ".mov", ".avi", ".ogv", ".ts", ".mpg", ".mpeg", ".wmv", ".flv"}
SUB_EXTS = {".srt", ".vtt"}

MIME = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
    ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
    ".ogv": "video/ogg", ".ts": "video/mp2t", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
    ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
    ".srt": "text/vtt; charset=utf-8",   # always served converted to WebVTT
    ".vtt": "text/vtt; charset=utf-8",
}

CODE_RE = re.compile(r"^[A-Z0-9]{4,12}$")
HOST_ONLINE_WINDOW = 6.0        # seconds
REQUEST_TTL = 600.0             # seconds
MAX_REQUESTS = 200
BODY_LIMIT = 64 * 1024
CHUNK = 1024 * 1024             # 1 MiB stream chunks
AUTO = object()                 # sentinel for "pick subtitle automatically"

# ----------------------------------------------------------------------------
# Tiny in-memory state, persisted to a JSON file so restarts/refreshes are safe
# ----------------------------------------------------------------------------
class Store:
    def __init__(self, state_path):
        self.path = state_path
        self.lock = threading.RLock()  # reentrant: view() -> room() both lock
        self.rooms = {}        # code -> dict
        self.queues = {}       # code -> {"next": int, "items": [ {id, action, amount, at} ]}
        self._load()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for code, r in (raw.get("rooms") or {}).items():
                if CODE_RE.match(code):
                    self.rooms[code] = {
                        "file": r.get("file"),
                        "subtitle": r.get("subtitle"),
                        "current_time": float(r.get("current_time") or 0),
                        "is_playing": bool(r.get("is_playing")),
                        "updated_at": float(r.get("updated_at") or 0),
                        "host_seen_at": float(r.get("host_seen_at") or 0),
                    }
            for code, q in (raw.get("queues") or {}).items():
                if CODE_RE.match(code):
                    self.queues[code] = {"next": int(q.get("next") or 1), "items": list(q.get("items") or [])}
        except Exception:
            pass  # first run / unreadable — start fresh

    def save(self):
        with self.lock:
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump(
                        {"version": VERSION, "rooms": self.rooms, "queues": self.queues},
                        f, indent=1,
                    )
            except Exception as e:
                print(f"[moviewatch] could not save state: {e}", flush=True)

    def ensure_room(self, code):
        with self.lock:
            if code not in self.rooms:
                self.rooms[code] = {"file": None, "subtitle": None, "current_time": 0.0,
                                    "is_playing": False, "updated_at": 0.0, "host_seen_at": 0.0}
            return self.rooms[code]

    def room(self, code):
        with self.lock:
            return self.rooms.get(code)

    def view(self, code, now):
        r = self.room(code)
        if not r:
            return None
        with self.lock:
            media = f"/media/{code}/{urllib.parse.quote(r['file'])}" if r["file"] else None
            sub = f"/media/{code}/{urllib.parse.quote(r['subtitle'])}" if r["subtitle"] else None
            return {
                "code": code,
                "file": r["file"],
                "subtitle": r["subtitle"],
                "current_time": r["current_time"],
                "is_playing": r["is_playing"],
                "updated_at": r["updated_at"],
                "host_online": (now - r["host_seen_at"]) < HOST_ONLINE_WINDOW,
                "media_url": media,
                "subtitle_url": sub,
            }

    def apply_state(self, code, body):
        r = self.ensure_room(code)
        with self.lock:
            if "current_time" in body:
                t = float(body["current_time"])
                if t < 0 or t != t:  # NaN guard
                    return False
                r["current_time"] = t
            if "is_playing" in body:
                r["is_playing"] = bool(body["is_playing"])
            r["updated_at"] = _now()
            r["host_seen_at"] = _now()
        return True

    def select(self, code, file, subtitle):
        r = self.ensure_room(code)
        with self.lock:
            r["file"] = file
            r["subtitle"] = subtitle
            r["current_time"] = 0.0
            r["is_playing"] = False
            r["updated_at"] = _now()
            r["host_seen_at"] = _now()

    def set_subtitle(self, code, subtitle):
        r = self.ensure_room(code)
        with self.lock:
            r["subtitle"] = subtitle
            r["updated_at"] = _now()
            r["host_seen_at"] = _now()

    def touch_host(self, code):
        r = self.room(code)
        if r:
            with self.lock:
                r["host_seen_at"] = _now()

    def push_request(self, code, action, amount=None):
        with self.lock:
            q = self.queues.setdefault(code, {"next": 1, "items": []})
            item = {"id": q["next"], "action": action, "amount": amount, "at": _now()}
            q["next"] += 1
            q["items"].append(item)
            cutoff = _now() - REQUEST_TTL
            q["items"] = [i for i in q["items"] if i["at"] >= cutoff][-MAX_REQUESTS:]
            return item

    def requests_after(self, code, after):
        with self.lock:
            q = self.queues.get(code) or {"next": 1, "items": []}
            return [i for i in q["items"] if i["id"] > after], q["next"] - 1


def _now():
    return float(time.time())


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def list_media(folder):
    videos, subs = [], []
    try:
        for name in sorted(os.listdir(folder)):
            p = os.path.join(folder, name)
            if not os.path.isfile(p):
                continue
            ext = os.path.splitext(name)[1].lower()
            try:
                size = os.path.getsize(p)
            except OSError:
                continue
            entry = {"name": name, "size": size, "modified": int(os.path.getmtime(p))}
            if ext in VIDEO_EXTS:
                videos.append(entry)
            elif ext in SUB_EXTS:
                subs.append(entry)
    except OSError:
        pass
    videos.sort(key=lambda e: -e["modified"])
    return videos, subs


def auto_subtitle(folder, video):
    """Find a subtitle file that matches the movie's name (base or base.*)."""
    _, subs = list_media(folder)
    base = os.path.splitext(video)[0].lower()
    exact = [s["name"] for s in subs if os.path.splitext(s["name"])[0].lower() == base]
    if exact:
        return sorted(exact)[0]
    loose = [s["name"] for s in subs if os.path.splitext(s["name"])[0].lower().startswith(base + ".")]
    # only auto-pick when there's exactly one candidate (avoid movie.part2 mixups)
    return sorted(loose)[0] if len(loose) == 1 else None


SRT_TIME = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")


def to_vtt(data):
    """Convert SRT bytes to WebVTT bytes (VTT passes through)."""
    text = data.decode("utf-8-sig", errors="replace")

    def fix(m):
        return f"{int(m.group(1)):02d}:{m.group(2)}:{m.group(3)}.{m.group(4).ljust(3, '0')}"

    text = SRT_TIME.sub(fix, text)
    if not text.lstrip().startswith("WEBVTT"):
        text = "WEBVTT\n\n" + text
    return text.encode("utf-8")


def parse_range(header, size):
    """Return (start, end) inclusive, None for no/invalid header, or 'invalid'."""
    if not header:
        return None
    m = re.match(r"^bytes=(\d*)-(\d*)$", header.strip())
    if not m:
        return "invalid"
    a, b = m.group(1), m.group(2)
    if a == "" and b == "":
        return "invalid"
    if a == "":
        n = int(b)
        if n == 0:
            return "invalid"
        return (max(0, size - n), size - 1)
    start = int(a)
    end = size - 1 if b == "" else min(int(b), size - 1)
    if start >= size or start > end:
        return "invalid"
    return (start, end)


def resolve_folder(cli_dir):
    """Decide which folder to serve.
    Order: --dir flag -> folder picker -> smart fallbacks (the script's own
    folder or the current folder, if either contains videos)."""
    if cli_dir:
        return os.path.abspath(os.path.expanduser(cli_dir))

    print("A folder picker is opening — choose the folder that contains your movies.\n", flush=True)
    picked = pick_folder_with_dialog()
    if picked:
        return os.path.abspath(picked)

    # Picker closed/cancelled/unavailable: fall back to a folder that
    # actually has videos, so we never serve an empty "movies/movies" dir.
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (here, os.getcwd()):
        vids, _subs = list_media(cand)
        if vids:
            print(f"(No folder picked — using the folder this script is in: {cand})\n", flush=True)
            return cand

    fallback = os.path.join(here, "movies")
    os.makedirs(fallback, exist_ok=True)
    return fallback


def pick_folder_with_dialog():
    """Native folder picker (Windows/macOS). Returns a path or None."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askdirectory(title="Moviewatch — pick your movies folder")
        root.destroy()
        return path or None
    except Exception:
        return None


# ----------------------------------------------------------------------------
# HTTP server
# ----------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"Moviewatch/{VERSION}"

    # injected via server.*
    store: Store = None
    folder: str = ""

    def log_message(self, fmt, *args):  # quieter logs
        pass

    # ---- plumbing ----------------------------------------------------------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send(self, status, headers=None, body=b""):
        self.send_response(status)
        self._cors()
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, {"Content-Type": "application/json; charset=utf-8"},
                   json.dumps(obj).encode("utf-8"))

    def _consume_body(self):
        """Read and stash the raw body. Must ALWAYS happen for POST/PUT before
        answering, otherwise unread bytes corrupt keep-alive connections."""
        self._raw_body = b""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return
        if n > BODY_LIMIT:
            # drain what we can, then bail
            self.rfile.read(min(n, BODY_LIMIT + 1))
            raise ValueError("body_too_large")
        self._raw_body = self.rfile.read(n)

    def _body(self):
        if getattr(self, "_raw_body", b"") == b"":
            return {}
        try:
            return json.loads(self._raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("invalid_json")

    def do_OPTIONS(self):
        self._send(204)

    # ---- routes ------------------------------------------------------------
    def do_GET(self):
        self.route(head=False)

    def do_HEAD(self):
        self.route(head=True)

    def do_POST(self):
        self._consume_body()
        self.route(post=True)

    def do_PUT(self):
        self._consume_body()
        self.route(post=True)

    def route(self, head=False, post=False):
        try:
            u = urllib.parse.urlsplit(self.path)
            parts = [urllib.parse.unquote(p) for p in u.path.split("/") if p]

            if u.path == "/api/health" and not post:
                return self._json(200, {"ok": True, "name": "moviewatch-media-server", "version": VERSION})

            if u.path in ("/", "/index.html") and not post:
                html = INDEX_HTML.format(
                    folder=self.folder.replace("<", "&lt;"),
                    rooms=len(self.store.rooms),
                    version=VERSION,
                ).encode("utf-8")
                return self._send(200, {"Content-Type": "text/html; charset=utf-8"}, html)

            if u.path == "/api/rooms" and post:
                body = self._body()
                code = str(body.get("code") or "").upper()
                if not CODE_RE.match(code):
                    return self._json(400, {"ok": False, "error": "bad_code",
                                            "message": "Room codes are 4-12 letters/digits."})
                self.store.ensure_room(code)
                self.store.save()
                print(f"[room] registered {code}", flush=True)
                return self._json(200, {"ok": True, "room": self.store.view(code, _now())})

            if u.path == "/api/files" and not post:
                code = (urllib.parse.parse_qs(u.query).get("k") or [""])[0].upper()
                if not self.store.room(code):
                    return self._json(403, {"ok": False, "error": "unknown_room",
                                            "message": "Register the room first."})
                videos, subs = list_media(self.folder)
                return self._json(200, {"ok": True, "videos": videos, "subtitles": subs})

            if len(parts) == 3 and parts[:2] == ["api", "rooms"] and not post:
                view = self.store.view(parts[2].upper(), _now())
                if not view:
                    return self._json(404, {"ok": False, "error": "room_not_registered",
                                            "message": "This room is not registered on the host device."})
                return self._json(200, {"ok": True, "room": view})

            if len(parts) == 4 and parts[:2] == ["api", "rooms"] and post:
                code = parts[2].upper()
                if not self.store.room(code):
                    return self._json(404, {"ok": False, "error": "room_not_registered"})
                action = parts[3]
                body = self._body()

                if action == "state":
                    if not self.store.apply_state(code, body):
                        return self._json(400, {"ok": False, "error": "bad_state"})
                    self.store.save()
                    return self._json(200, {"ok": True, "room": self.store.view(code, _now())})

                if action == "select":
                    videos, subs = list_media(self.folder)
                    names = [v["name"] for v in videos]
                    if body.get("file") not in names:
                        return self._json(400, {"ok": False, "error": "unknown_file",
                                                "message": "That file is not in the movies folder."})
                    wanted = body.get("subtitle", AUTO)
                    if wanted is AUTO:
                        subtitle = auto_subtitle(self.folder, body["file"])
                    elif wanted is None:
                        subtitle = None
                    else:
                        subtitle = wanted if wanted in [s["name"] for s in subs] else None
                    self.store.select(code, body["file"], subtitle)
                    self.store.save()
                    print(f"[room] {code} -> {body['file']} (subs: {subtitle or 'none'})", flush=True)
                    return self._json(200, {"ok": True, "room": self.store.view(code, _now())})

                if action == "subtitle":
                    wanted = body.get("file")
                    if wanted is not None:
                        _, subs = list_media(self.folder)
                        if wanted not in [s["name"] for s in subs]:
                            return self._json(400, {"ok": False, "error": "unknown_file"})
                    self.store.set_subtitle(code, wanted)
                    self.store.save()
                    return self._json(200, {"ok": True, "room": self.store.view(code, _now())})

                if action == "requests" and self.command == "POST":
                    act = body.get("action")
                    if act not in ("play", "pause", "seek"):
                        return self._json(400, {"ok": False, "error": "bad_action"})
                    amount = None
                    if act == "seek":
                        try:
                            amount = int(body.get("amount") or 0)
                        except (TypeError, ValueError):
                            return self._json(400, {"ok": False, "error": "bad_action"})
                        amount = max(-600, min(600, amount))
                    item = self.store.push_request(code, act, amount)
                    self.store.save()
                    return self._json(200, {"ok": True, "request": item})

            if len(parts) == 4 and parts[:2] == ["api", "rooms"] and parts[3] == "requests" and not post:
                code = parts[2].upper()
                if not self.store.room(code):
                    return self._json(404, {"ok": False, "error": "room_not_registered"})
                after = int((urllib.parse.parse_qs(u.query).get("after") or ["0"])[0] or 0)
                items, cursor = self.store.requests_after(code, after)
                return self._json(200, {"ok": True, "items": items, "cursor": cursor})

            if len(parts) >= 3 and parts[0] == "media" and not post:
                code = parts[1].upper()
                name = "/".join(parts[2:])
                return self.serve_media(code, name, head=head)

            return self._json(404, {"ok": False, "error": "not_found"})
        except ValueError as e:
            msg = "Body must be JSON." if str(e) == "invalid_json" else "Bad request."
            return self._json(400, {"ok": False, "error": str(e), "message": msg})
        except json.JSONDecodeError:
            return self._json(400, {"ok": False, "error": "invalid_json", "message": "Body must be JSON."})
        except BrokenPipeError:
            return None  # viewer closed the tab mid-stream — normal
        except Exception as e:
            print(f"[moviewatch] error on {self.path}: {e}", flush=True)
            try:
                self._json(500, {"ok": False, "error": "server_error"})
            except Exception:
                pass

    # ---- media streaming with Range support --------------------------------
    def serve_media(self, code, name, head=False):
        if not self.store.room(code):
            return self._json(403, {"ok": False, "error": "unknown_room",
                                    "message": "This room code is not registered on the host device."})
        if not name or "/" in name or "\\" in name or name.startswith(".") or ".." in name or ":" in name:
            return self._json(400, {"ok": False, "error": "bad_name"})
        # normalized absolute-path check (Windows-safe)
        path = os.path.abspath(os.path.join(self.folder, name))
        if os.path.dirname(path) != os.path.abspath(self.folder):
            return self._json(400, {"ok": False, "error": "bad_name"})
        if not os.path.isfile(path):
            return self._json(404, {"ok": False, "error": "not_found",
                                    "message": "That file is not in the host's movies folder."})

        ext = os.path.splitext(name)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")

        # Subtitles: convert .srt -> WebVTT on the fly (tiny files; read whole)
        if ext in SUB_EXTS:
            with open(path, "rb") as f:
                payload = f.read()
            if ext == ".srt":
                payload = to_vtt(payload)
            return self._send(200, {"Content-Type": ctype, "Cache-Control": "no-store"}, payload)

        size = os.path.getsize(path)
        rng = parse_range(self.headers.get("Range"), size)

        base_headers = {"Content-Type": ctype, "Accept-Ranges": "bytes", "Cache-Control": "no-store"}

        if rng is None:
            self.send_response(200)
            self._cors()
            for k, v in base_headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if head or self.command == "HEAD":
                return
            return self._pipe(path, 0, size - 1)

        if rng == "invalid":
            return self._send(416, {"Content-Range": f"bytes */{size}"})

        start, end = rng
        self.send_response(206)
        self._cors()
        for k, v in base_headers.items():
            self.send_header(k, v)
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        if head or self.command == "HEAD":
            return
        return self._pipe(path, start, end)

    def _pipe(self, path, start, end):
        try:
            with open(path, "rb") as f:
                f.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # viewer paused/closed — stop streaming, that's fine
        except Exception as e:
            print(f"[media] stream error: {e}", flush=True)


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 32


INDEX_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>Moviewatch host device</title></head>
<body style="font-family:system-ui;background:#0b0d18;color:#e2e8f0;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>&#127916; Moviewatch host device</h1>
<p>This computer is streaming a movie for a watch party. You probably want the
app itself — open the invite link you were sent.</p>
<ul>
  <li>Movies folder: <code>{folder}</code></li>
  <li>Rooms registered here: <strong>{rooms}</strong></li>
  <li>Server version: {version}</li>
</ul>
</body></html>"""


# ----------------------------------------------------------------------------
# Entry point
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Moviewatch media server")
    ap.add_argument("--dir", help="Folder that contains your movies (default: asks, or ./movies)")
    ap.add_argument("--port", type=int, default=7777)
    ap.add_argument("--host", default="127.0.0.1", help="Bind address (default 127.0.0.1)")
    ap.add_argument("--state", default=None, help="State file (default: moviewatch-state.json next to this script)")
    args = ap.parse_args()

    folder = resolve_folder(args.dir)
    os.makedirs(folder, exist_ok=True)
    vids, _subs = list_media(folder)
    if not vids:
        print(f"  NOTE: no video files found in:\n    {folder}")
        print("  Re-run it and pick the correct folder, or point at it directly:")
        print(f'    python {os.path.basename(__file__)} --dir "C:\\path\\to\\your\\movies"\n')

    state_path = os.path.abspath(args.state or os.path.join(os.path.dirname(os.path.abspath(__file__)), "moviewatch-state.json"))

    store = Store(state_path)
    Handler.store = store
    Handler.folder = folder

    try:
        server = Server((args.host, args.port), Handler)
    except OSError as e:
        if "in use" in str(e) or e.errno in (48, 98, 10048):
            print(f"\nPort {args.port} is busy. Run again with:  --port {args.port + 1}\n")
            sys.exit(1)
        raise

    line = "=" * 62
    print(f"""
{line}
  MOVIEWATCH media server v{VERSION}  —  keep this window open!

  Movies folder : {folder}
  Videos found  : {len(vids)}
  Local address : http://localhost:{args.port}

  THIS BLACK WINDOW IS THE SERVER. Closing it stops the party.

  NEXT STEP — in a SECOND window, give it a public address:

    cloudflared tunnel --url http://localhost:{args.port}

  Copy the https://xxxx.trycloudflare.com it prints into your room page
  on the website. That address works all evening while the tunnel window
  stays open. (If you restart the tunnel, it prints a NEW address.)

  Want a link that never changes? README > "A permanent link".
{line}
""", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye! (state was saved)", flush=True)


if __name__ == "__main__":
    main()
