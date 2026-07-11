#!/usr/bin/env python3
"""Tiny dependency-free server for Fun Games.

Does two jobs at once:
  1. Serves the static site (index.html, snake.html, snake.js, ...) exactly like
     `python3 -m http.server` did, by subclassing SimpleHTTPRequestHandler.
  2. Adds a small JSON API for a GLOBAL Snake leaderboard:
       GET  /api/leaderboard  -> top 20 scores, best first
       POST /api/score        -> add a score, returns the new top 20.
                                 Body: {name, apples, timeMs, replace?}.
                                 Names must be UNIQUE: if the (normalized) name
                                 already exists, the score is rejected with 409
                                 and nothing is stored — UNLESS replace is JSON
                                 true, in which case all stored entries with that
                                 normalized name are removed and the new one is
                                 stored (a returning player updating their own
                                 high score).

Scores live in leaderboard.json next to this file. Reads/writes are guarded by a
lock so two players submitting at the same time can't corrupt the file.

Only the Python 3 standard library is used. No pip, no frameworks.
"""

import json
import os
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# ---- Config ---------------------------------------------------------------
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(PROJECT_DIR, "leaderboard.json")
VISITS_FILE = os.path.join(PROJECT_DIR, "visits.json")
PORT = int(os.environ.get("PORT", "8787"))
HOST = os.environ.get("HOST", "127.0.0.1")

# How many entries we return to the page vs. how many we keep on disk.
TOP_N = 20
MAX_STORED = 500

# Sanitizing limits.
MAX_NAME_LEN = 16
MAX_APPLES = 100000
MAX_TIME_MS = 7 * 24 * 60 * 60 * 1000  # one week in ms — generous upper bound

# One lock protects every read-modify-write of the leaderboard file.
_lock = threading.Lock()

# A separate lock guards the global visit counter file.
_visits_lock = threading.Lock()

# Strip HTML-ish angle brackets and ampersands so names can't inject markup.
_HTML_CHARS = re.compile(r"[<>&]")


# ---- Storage helpers ------------------------------------------------------
def _load_scores():
    """Read the score list from disk. Returns [] if missing or unreadable."""
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        # Corrupt or unreadable file shouldn't take the whole API down.
        return []


def _save_scores(scores):
    """Write scores to disk atomically-ish (write temp, then replace)."""
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


def _rank_key(entry):
    """Best first: most apples, then longest survival time."""
    return (-int(entry.get("apples", 0)), -int(entry.get("timeMs", 0)))


def _top(scores, n=TOP_N):
    return sorted(scores, key=_rank_key)[:n]


# ---- Visit counter helpers ------------------------------------------------
def _load_visits():
    """Read the visit count from disk. Returns 0 if missing or unreadable."""
    if not os.path.exists(VISITS_FILE):
        return 0
    try:
        with open(VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        # Corrupt or unreadable file shouldn't take the whole API down.
        return 0


def _save_visits(visits):
    """Write the visit count to disk atomically-ish (write temp, then replace)."""
    tmp = VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, VISITS_FILE)


# ---- Input sanitizing -----------------------------------------------------
def _clean_name(raw):
    """Turn whatever the client sent into a safe, short display name."""
    if not isinstance(raw, str):
        raw = "" if raw is None else str(raw)
    # Drop control characters (newlines, tabs, etc.).
    raw = "".join(ch for ch in raw if ord(ch) >= 32)
    # Remove HTML-ish characters.
    raw = _HTML_CHARS.sub("", raw)
    raw = raw.strip()[:MAX_NAME_LEN].strip()
    return raw or "anon"


def _normalize_name(raw):
    """Fold a name to a stable identity key for same-account matching.

    We match players case-insensitively and ignoring surrounding whitespace, but
    we still STORE their original display name untouched.
    """
    if not isinstance(raw, str):
        raw = "" if raw is None else str(raw)
    return raw.strip().casefold()


def _clean_int(raw, cap):
    """Coerce to a non-negative int within [0, cap]. Raises ValueError if junk."""
    if isinstance(raw, bool):  # bool is a subclass of int — reject it explicitly
        raise ValueError("expected number, got bool")
    if isinstance(raw, float):
        raw = int(raw)
    if not isinstance(raw, int):
        # Allow numeric strings like "42".
        raw = int(str(raw).strip())
    if raw < 0:
        raw = 0
    if raw > cap:
        raw = cap
    return raw


# ---- Request handler ------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    # Serve static files out of the project directory regardless of cwd.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PROJECT_DIR, **kwargs)

    # ---- shared response helpers ----
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ---- preflight ----
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- GET: API first, otherwise static files ----
    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if route == "/api/leaderboard":
            with _lock:
                board = _top(_load_scores())
            self._send_json({"scores": board})
            return
        if route == "/api/visits":
            # Return the current count WITHOUT incrementing (for polling).
            with _visits_lock:
                visits = _load_visits()
            self._send_json({"visits": visits})
            return
        super().do_GET()

    # ---- POST: score and visit endpoints ----
    def do_POST(self):
        route = self.path.split("?", 1)[0]
        if route == "/api/visit":
            # Increment the global visit counter by exactly one.
            with _visits_lock:
                visits = _load_visits() + 1
                _save_visits(visits)
            self._send_json({"visits": visits})
            return
        if route != "/api/score":
            self._send_json({"error": "not found"}, status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 10000:  # reject empty or absurdly large bodies
            self._send_json({"error": "bad request"}, status=400)
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("body must be a JSON object")
            name = _clean_name(payload.get("name"))
            apples = _clean_int(payload.get("apples"), MAX_APPLES)
            time_ms = _clean_int(payload.get("timeMs"), MAX_TIME_MS)
            # Optional "replace" flag — STRICT: only a real JSON true counts.
            # Anything else (missing, false, "true", 1, null) means a normal
            # unique-name submission.
            replace = payload.get("replace") is True
        except (ValueError, UnicodeDecodeError, TypeError):
            self._send_json({"error": "invalid score payload"}, status=400)
            return

        entry = {
            "name": name,
            "apples": apples,
            "timeMs": time_ms,
            "ts": int(time.time() * 1000),
        }

        with _lock:
            scores = _load_scores()
            norm = _normalize_name(name)
            if replace:
                # A returning player updating THEIR OWN high score: drop every
                # stored entry with this normalized name, then append the new
                # one. NOTE: there is no real authentication here, so a client
                # could send replace=true for any name. The frontend gates this
                # by device-remembered ownership (localStorage). That's an
                # acceptable trade-off for a casual game with no login.
                scores = [
                    e for e in scores if _normalize_name(e.get("name")) != norm
                ]
            elif any(_normalize_name(e.get("name")) == norm for e in scores):
                # Names must be UNIQUE for a normal submission. If the name
                # already exists, reject it (the player should pick another, or
                # the frontend should resubmit with replace=true for their own).
                self._send_json(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    },
                    status=409,
                )
                return
            scores.append(entry)
            # Keep only the best MAX_STORED to bound file size.
            scores = _top(scores, MAX_STORED)
            _save_scores(scores)
            board = scores[:TOP_N]

        self._send_json({"scores": board})

    # Quieter logging (one tidy line per request).
    def log_message(self, fmt, *args):
        print("[fungames] %s - %s" % (self.address_string(), fmt % args))


def main():
    # Make sure the storage file exists so the first GET returns a real list.
    if not os.path.exists(DATA_FILE):
        _save_scores([])
    # Same for the visit counter, so the first GET returns a real number.
    if not os.path.exists(VISITS_FILE):
        _save_visits(0)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Fun Games server on http://%s:%d (serving %s)" % (HOST, PORT, PROJECT_DIR))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
