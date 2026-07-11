#!/usr/bin/env python3
"""Flask version of the Fun Games server, for PythonAnywhere's free tier.

This is the SAME app as server.py, just packaged as a WSGI app so it can run on
PythonAnywhere (which runs WSGI web apps and has Flask preinstalled). It does two
jobs at once:

  1. Serves the static site (index.html, snake.html, snake.js, ...) from this
     file's own folder.
  2. Adds the small JSON API for the GLOBAL Snake leaderboard:
       GET  /api/leaderboard  -> top 20 scores, best first
       POST /api/score        -> add a score, returns the new top 20.
                                 Body: {name, apples, timeMs, replace?}.
                                 Names must be UNIQUE: if the (normalized) name
                                 already exists, the score is rejected with 409
                                 and nothing is stored — UNLESS replace is JSON
                                 true, in which case all stored entries with that
                                 normalized name are removed and the new one is
                                 stored.

Scores live in leaderboard.json next to this file. Reads/writes are guarded by a
lock and written atomically (temp file + os.replace), so two players submitting
at the same time can't corrupt the file.

PythonAnywhere's WSGI config imports the `app` object below as `application`.
Don't hardcode a host/port here — PythonAnywhere manages that.
"""

import hashlib
import json
import os
import re
import secrets
import threading
import time

from flask import Flask, jsonify, request, send_from_directory

# ---- Config ---------------------------------------------------------------
# Absolute path based on THIS file's folder, so storage works no matter what
# working directory PythonAnywhere runs us from.
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(PROJECT_DIR, "leaderboard.json")
VISITS_FILE = os.path.join(PROJECT_DIR, "visits.json")

# Chess gets its OWN storage files, independent from Snake's.
CHESS_DATA_FILE = os.path.join(PROJECT_DIR, "chess_leaderboard.json")
CHESS_VISITS_FILE = os.path.join(PROJECT_DIR, "chess_visits.json")

# Flappy Parrot gets its OWN storage files too, independent from the others.
FLAPPY_DATA_FILE = os.path.join(PROJECT_DIR, "flappy_leaderboard.json")
FLAPPY_VISITS_FILE = os.path.join(PROJECT_DIR, "flappy_visits.json")

# Minesweeper gets its OWN storage files too, independent from the others.
MINES_DATA_FILE = os.path.join(PROJECT_DIR, "mines_leaderboard.json")
MINES_VISITS_FILE = os.path.join(PROJECT_DIR, "mines_visits.json")

# Breakout gets its OWN storage files too, independent from the others.
BREAKOUT_DATA_FILE = os.path.join(PROJECT_DIR, "breakout_leaderboard.json")
BREAKOUT_VISITS_FILE = os.path.join(PROJECT_DIR, "breakout_visits.json")

# How many entries we return to the page vs. how many we keep on disk.
TOP_N = 20
MAX_STORED = 500

# Sanitizing limits.
MAX_NAME_LEN = 16
MAX_APPLES = 100000
# Flappy scores are "vines passed"; cap generously so junk can't store nonsense.
MAX_FLAPPY_SCORE = 100000
# Breakout scores are brick points; cap generously so junk can't store nonsense.
MAX_BREAKOUT_SCORE = 10000000
MAX_TIME_MS = 7 * 24 * 60 * 60 * 1000  # one week in ms — generous upper bound
# A full chess game can't realistically take more than a few hundred player
# moves; cap generously so junk input can't store an absurd number.
MAX_MOVES = 10000

# Minesweeper clear times are stored as whole SECONDS; cap at a day so junk
# input can't store an absurd number.
MAX_MINES_TIME = 24 * 60 * 60

# Minesweeper "revealed"/"total" are safe-cell counts. The largest board is
# 16x30 with 99 mines, so the most safe cells is well under this generous cap.
MAX_MINES_CELLS = 100000

# Valid chess bot difficulties; anything else falls back to "easy".
CHESS_DIFFICULTIES = ("easy", "medium", "hard")

# Minesweeper difficulties share the same names as chess.
MINES_DIFFICULTIES = ("easy", "medium", "hard")

# One lock protects every read-modify-write of the leaderboard file.
_lock = threading.Lock()

# A separate lock guards the global visit counter file.
_visits_lock = threading.Lock()

# Chess has its own locks so it never contends with the Snake endpoints.
_chess_lock = threading.Lock()
_chess_visits_lock = threading.Lock()

# Flappy has its own locks so it never contends with the other games.
_flappy_lock = threading.Lock()
_flappy_visits_lock = threading.Lock()

# Minesweeper has its own locks so it never contends with the other games.
_mines_lock = threading.Lock()
_mines_visits_lock = threading.Lock()

# Breakout has its own locks so it never contends with the other games.
_breakout_lock = threading.Lock()
_breakout_visits_lock = threading.Lock()

# Strip HTML-ish angle brackets and ampersands so names can't inject markup.
_HTML_CHARS = re.compile(r"[<>&]")

app = Flask(__name__, static_folder=None)


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


# ---- Chess storage helpers ------------------------------------------------
def _load_chess_scores():
    """Read the chess score list from disk. Returns [] if missing/unreadable."""
    if not os.path.exists(CHESS_DATA_FILE):
        return []
    try:
        with open(CHESS_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        return []


def _save_chess_scores(scores):
    """Write chess scores to disk atomically-ish (write temp, then replace)."""
    tmp = CHESS_DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CHESS_DATA_FILE)


def _chess_rank_key(entry):
    """Best first: FEWEST player moves wins; tie → earliest submission."""
    return (int(entry.get("moves", 0)), int(entry.get("ts", 0)))


def _chess_top(scores, n=TOP_N):
    return sorted(scores, key=_chess_rank_key)[:n]


def _clean_difficulty(raw):
    """Normalize a difficulty to one of CHESS_DIFFICULTIES, fallback 'easy'."""
    if not isinstance(raw, str):
        raw = "" if raw is None else str(raw)
    raw = raw.strip().lower()
    return raw if raw in CHESS_DIFFICULTIES else "easy"


# ---- Flappy storage helpers -----------------------------------------------
def _load_flappy_scores():
    """Read the flappy score list from disk. Returns [] if missing/unreadable."""
    if not os.path.exists(FLAPPY_DATA_FILE):
        return []
    try:
        with open(FLAPPY_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        return []


def _save_flappy_scores(scores):
    """Write flappy scores to disk atomically-ish (write temp, then replace)."""
    tmp = FLAPPY_DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, FLAPPY_DATA_FILE)


def _flappy_rank_key(entry):
    """Best first: HIGHEST score wins; tie → earliest submission."""
    return (-int(entry.get("score", 0)), int(entry.get("ts", 0)))


def _flappy_top(scores, n=TOP_N):
    return sorted(scores, key=_flappy_rank_key)[:n]


# ---- Flappy visit counter helpers -----------------------------------------
def _load_flappy_visits():
    """Read the flappy visit count from disk. Returns 0 if missing/unreadable."""
    if not os.path.exists(FLAPPY_VISITS_FILE):
        return 0
    try:
        with open(FLAPPY_VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        return 0


def _save_flappy_visits(visits):
    """Write the flappy visit count atomically-ish (write temp, then replace)."""
    tmp = FLAPPY_VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, FLAPPY_VISITS_FILE)


# ---- Breakout storage helpers ---------------------------------------------
def _load_breakout_scores():
    """Read the breakout score list from disk. Returns [] if missing/unreadable."""
    if not os.path.exists(BREAKOUT_DATA_FILE):
        return []
    try:
        with open(BREAKOUT_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        return []


def _save_breakout_scores(scores):
    """Write breakout scores to disk atomically-ish (write temp, then replace)."""
    tmp = BREAKOUT_DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, BREAKOUT_DATA_FILE)


def _breakout_rank_key(entry):
    """Best first: HIGHEST score wins; tie → earliest submission."""
    return (-int(entry.get("score", 0)), int(entry.get("ts", 0)))


def _breakout_top(scores, n=TOP_N):
    return sorted(scores, key=_breakout_rank_key)[:n]


# ---- Breakout visit counter helpers ---------------------------------------
def _load_breakout_visits():
    """Read the breakout visit count from disk. Returns 0 if missing/unreadable."""
    if not os.path.exists(BREAKOUT_VISITS_FILE):
        return 0
    try:
        with open(BREAKOUT_VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        return 0


def _save_breakout_visits(visits):
    """Write the breakout visit count atomically-ish (write temp, then replace)."""
    tmp = BREAKOUT_VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, BREAKOUT_VISITS_FILE)


# ---- Minesweeper storage helpers ------------------------------------------
def _load_mines_scores():
    """Read the mines score list from disk. Returns [] if missing/unreadable."""
    if not os.path.exists(MINES_DATA_FILE):
        return []
    try:
        with open(MINES_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        return []


def _save_mines_scores(scores):
    """Write mines scores to disk atomically-ish (write temp, then replace)."""
    tmp = MINES_DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MINES_DATA_FILE)


def _mines_rank_key(entry):
    """Best first: MOST safe cells revealed wins; ties broken by FASTER time,
    then earliest submission. (revealed is negated so a normal ascending sort
    puts the biggest reveal count first.)"""
    return (
        -int(entry.get("revealed", 0) or 0),
        int(entry.get("time", 0) or 0),
        int(entry.get("ts", 0) or 0),
    )


def _mines_top(scores, n=TOP_N):
    return sorted(scores, key=_mines_rank_key)[:n]


def _clean_mines_difficulty(raw):
    """Normalize a difficulty to one of MINES_DIFFICULTIES, fallback 'easy'."""
    if not isinstance(raw, str):
        raw = "" if raw is None else str(raw)
    raw = raw.strip().lower()
    return raw if raw in MINES_DIFFICULTIES else "easy"


# ---- Minesweeper visit counter helpers ------------------------------------
def _load_mines_visits():
    """Read the mines visit count from disk. Returns 0 if missing/unreadable."""
    if not os.path.exists(MINES_VISITS_FILE):
        return 0
    try:
        with open(MINES_VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        return 0


def _save_mines_visits(visits):
    """Write the mines visit count atomically-ish (write temp, then replace)."""
    tmp = MINES_VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MINES_VISITS_FILE)


# ---- Chess visit counter helpers ------------------------------------------
def _load_chess_visits():
    """Read the chess visit count from disk. Returns 0 if missing/unreadable."""
    if not os.path.exists(CHESS_VISITS_FILE):
        return 0
    try:
        with open(CHESS_VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        return 0


def _save_chess_visits(visits):
    """Write the chess visit count atomically-ish (write temp, then replace)."""
    tmp = CHESS_VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CHESS_VISITS_FILE)


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


# ---- Response helpers -----------------------------------------------------
def _cors(resp):
    """Add permissive CORS headers. It'll be same-origin, but harmless."""
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.after_request
def _add_cors(resp):
    return _cors(resp)


# ---- Static site ----------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(PROJECT_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    """Serve any other asset (snake.html, snake.js, snake.css, style.css, ...).

    send_from_directory safely refuses paths that escape PROJECT_DIR, and never
    serves the leaderboard data or this script through here in a harmful way —
    but to be tidy we don't expose the raw data/code files to direct download.
    """
    return send_from_directory(PROJECT_DIR, filename)


# ---- API: leaderboard -----------------------------------------------------
@app.route("/api/leaderboard", methods=["GET", "OPTIONS"])
def api_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _lock:
        board = _top(_load_scores())
    return jsonify({"scores": board})


# ---- API: visit counter ---------------------------------------------------
@app.route("/api/visit", methods=["POST", "OPTIONS"])
def api_visit():
    """Increment the global visit counter by exactly one (one per page visit)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _visits_lock:
        visits = _load_visits() + 1
        _save_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/visits", methods=["GET", "OPTIONS"])
def api_visits():
    """Return the current visit count WITHOUT incrementing (for polling)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _visits_lock:
        visits = _load_visits()
    return jsonify({"visits": visits})


# ---- API: submit a score --------------------------------------------------
@app.route("/api/score", methods=["POST", "OPTIONS"])
def api_score():
    if request.method == "OPTIONS":
        return ("", 204)

    # Reject empty or absurdly large bodies, mirroring server.py.
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

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
        return jsonify({"error": "invalid score payload"}), 400

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
            # A returning player updating THEIR OWN high score: drop every stored
            # entry with this normalized name, then append the new one. There is
            # no real authentication; the frontend gates this by device-remembered
            # ownership (localStorage). Acceptable for a casual game with no login.
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            # Names must be UNIQUE for a normal submission.
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        # Keep only the best MAX_STORED to bound file size.
        scores = _top(scores, MAX_STORED)
        _save_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# ---- API: chess leaderboard -----------------------------------------------
@app.route("/api/chess/leaderboard", methods=["GET", "OPTIONS"])
def api_chess_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _chess_lock:
        board = _chess_top(_load_chess_scores())
    return jsonify({"scores": board})


# ---- API: chess visit counter ---------------------------------------------
@app.route("/api/chess/visit", methods=["POST", "OPTIONS"])
def api_chess_visit():
    """Increment the chess visit counter by exactly one (one per page visit)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _chess_visits_lock:
        visits = _load_chess_visits() + 1
        _save_chess_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/chess/visits", methods=["GET", "OPTIONS"])
def api_chess_visits():
    """Return the chess visit count WITHOUT incrementing (for polling)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _chess_visits_lock:
        visits = _load_chess_visits()
    return jsonify({"visits": visits})


# ---- API: submit a chess score (only when the PLAYER wins) -----------------
@app.route("/api/chess/score", methods=["POST", "OPTIONS"])
def api_chess_score():
    if request.method == "OPTIONS":
        return ("", 204)

    # Reject empty or absurdly large bodies, mirroring the snake endpoint.
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        name = _clean_name(payload.get("name"))
        # A win in zero moves is impossible — require a positive move count.
        moves = _clean_int(payload.get("moves"), MAX_MOVES)
        if moves <= 0:
            raise ValueError("moves must be positive")
        difficulty = _clean_difficulty(payload.get("difficulty"))
        # Strict replace flag: only a real JSON true counts.
        replace = payload.get("replace") is True
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid score payload"}), 400

    entry = {
        "name": name,
        "moves": moves,
        "difficulty": difficulty,
        "ts": int(time.time() * 1000),
    }

    with _chess_lock:
        scores = _load_chess_scores()
        norm = _normalize_name(name)
        if replace:
            # Returning player updating their own best: drop every stored entry
            # with this normalized name, then append the new one. Gated on the
            # frontend by device-remembered ownership (localStorage).
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        # Keep only the best MAX_STORED (fewest moves) to bound file size.
        scores = _chess_top(scores, MAX_STORED)
        _save_chess_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# ---- API: flappy leaderboard ----------------------------------------------
@app.route("/api/flappy/leaderboard", methods=["GET", "OPTIONS"])
def api_flappy_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _flappy_lock:
        board = _flappy_top(_load_flappy_scores())
    return jsonify({"scores": board})


# ---- API: flappy visit counter --------------------------------------------
@app.route("/api/flappy/visit", methods=["POST", "OPTIONS"])
def api_flappy_visit():
    """Increment the flappy visit counter by exactly one (one per page visit)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _flappy_visits_lock:
        visits = _load_flappy_visits() + 1
        _save_flappy_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/flappy/visits", methods=["GET", "OPTIONS"])
def api_flappy_visits():
    """Return the flappy visit count WITHOUT incrementing (for polling)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _flappy_visits_lock:
        visits = _load_flappy_visits()
    return jsonify({"visits": visits})


# ---- API: submit a flappy score -------------------------------------------
@app.route("/api/flappy/score", methods=["POST", "OPTIONS"])
def api_flappy_score():
    if request.method == "OPTIONS":
        return ("", 204)

    # Reject empty or absurdly large bodies, mirroring the other endpoints.
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        name = _clean_name(payload.get("name"))
        # A score of 0 (no vines passed) is a perfectly valid run.
        score = _clean_int(payload.get("score"), MAX_FLAPPY_SCORE)
        # Strict replace flag: only a real JSON true counts.
        replace = payload.get("replace") is True
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid score payload"}), 400

    entry = {
        "name": name,
        "score": score,
        "ts": int(time.time() * 1000),
    }

    with _flappy_lock:
        scores = _load_flappy_scores()
        norm = _normalize_name(name)
        if replace:
            # Returning player updating their own best: drop every stored entry
            # with this normalized name, then append the new one. Gated on the
            # frontend by device-remembered ownership (localStorage).
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        # Keep only the best MAX_STORED (highest scores) to bound file size.
        scores = _flappy_top(scores, MAX_STORED)
        _save_flappy_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# ---- API: breakout leaderboard --------------------------------------------
@app.route("/api/breakout/leaderboard", methods=["GET", "OPTIONS"])
def api_breakout_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _breakout_lock:
        board = _breakout_top(_load_breakout_scores())
    return jsonify({"scores": board})


# ---- API: breakout visit counter ------------------------------------------
@app.route("/api/breakout/visit", methods=["POST", "OPTIONS"])
def api_breakout_visit():
    """Increment the breakout visit counter by exactly one (one per page visit)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _breakout_visits_lock:
        visits = _load_breakout_visits() + 1
        _save_breakout_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/breakout/visits", methods=["GET", "OPTIONS"])
def api_breakout_visits():
    """Return the breakout visit count WITHOUT incrementing (for polling)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _breakout_visits_lock:
        visits = _load_breakout_visits()
    return jsonify({"visits": visits})


# ---- API: submit a breakout score -----------------------------------------
@app.route("/api/breakout/score", methods=["POST", "OPTIONS"])
def api_breakout_score():
    if request.method == "OPTIONS":
        return ("", 204)

    # Reject empty or absurdly large bodies, mirroring the other endpoints.
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        name = _clean_name(payload.get("name"))
        # A score of 0 (no bricks smashed) is a perfectly valid run.
        score = _clean_int(payload.get("score"), MAX_BREAKOUT_SCORE)
        # Strict replace flag: only a real JSON true counts.
        replace = payload.get("replace") is True
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid score payload"}), 400

    entry = {
        "name": name,
        "score": score,
        "ts": int(time.time() * 1000),
    }

    with _breakout_lock:
        scores = _load_breakout_scores()
        norm = _normalize_name(name)
        if replace:
            # Returning player updating their own best: drop every stored entry
            # with this normalized name, then append the new one. Gated on the
            # frontend by device-remembered ownership (localStorage).
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        # Keep only the best MAX_STORED (highest scores) to bound file size.
        scores = _breakout_top(scores, MAX_STORED)
        _save_breakout_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# ---- API: minesweeper leaderboard -----------------------------------------
@app.route("/api/mines/leaderboard", methods=["GET", "OPTIONS"])
def api_mines_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _mines_lock:
        board = _mines_top(_load_mines_scores())
    return jsonify({"scores": board})


# ---- API: minesweeper visit counter ---------------------------------------
@app.route("/api/mines/visit", methods=["POST", "OPTIONS"])
def api_mines_visit():
    """Increment the mines visit counter by exactly one (one per page visit)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _mines_visits_lock:
        visits = _load_mines_visits() + 1
        _save_mines_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/mines/visits", methods=["GET", "OPTIONS"])
def api_mines_visits():
    """Return the mines visit count WITHOUT incrementing (for polling)."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _mines_visits_lock:
        visits = _load_mines_visits()
    return jsonify({"visits": visits})


# ---- API: submit a minesweeper score (on WIN or LOSS, ranked by progress) --
@app.route("/api/mines/score", methods=["POST", "OPTIONS"])
def api_mines_score():
    if request.method == "OPTIONS":
        return ("", 204)

    # Reject empty or absurdly large bodies, mirroring the other endpoints.
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        name = _clean_name(payload.get("name"))
        # Safe cells revealed (the ranking metric — higher is better) and the
        # total safe cells for that board. Both are non-negative; a loss with 0
        # reveals is allowed.
        revealed = _clean_int(payload.get("revealed"), MAX_MINES_CELLS)
        total = _clean_int(payload.get("total"), MAX_MINES_CELLS)
        # Clear/elapsed time in whole seconds. A 0-second run is technically
        # possible, so we accept >= 0 (unlike chess moves, which must be
        # positive).
        time_sec = _clean_int(payload.get("time"), MAX_MINES_TIME)
        difficulty = _clean_mines_difficulty(payload.get("difficulty"))
        # Whether the board was fully cleared (a win). Only a real JSON true
        # counts.
        won = payload.get("won") is True
        # Strict replace flag: only a real JSON true counts.
        replace = payload.get("replace") is True
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid score payload"}), 400

    entry = {
        "name": name,
        "revealed": revealed,
        "total": total,
        "time": time_sec,
        "difficulty": difficulty,
        "won": won,
        "ts": int(time.time() * 1000),
    }

    with _mines_lock:
        scores = _load_mines_scores()
        norm = _normalize_name(name)
        if replace:
            # Returning player updating their own best: drop every stored entry
            # with this normalized name, then append the new one. Gated on the
            # frontend by device-remembered ownership (localStorage).
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        # Keep only the best MAX_STORED (most cells revealed) to bound file size.
        scores = _mines_top(scores, MAX_STORED)
        _save_mines_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# ===========================================================================
# Mini War — top-down wave-survival arena battle. Leaderboard is HIGHEST score
# first (score = points earned across the waves you survive).
# ===========================================================================
MINIWAR_DATA_FILE = os.path.join(PROJECT_DIR, "miniwar_leaderboard.json")
MINIWAR_VISITS_FILE = os.path.join(PROJECT_DIR, "miniwar_visits.json")

# Score is generous; junk input can't store an absurd number.
MAX_MINIWAR_SCORE = 100000000
# Waves survived — also generous, but bounded.
MAX_MINIWAR_WAVE = 100000

_miniwar_lock = threading.Lock()
_miniwar_visits_lock = threading.Lock()


def _load_miniwar_scores():
    """Read the Mini War score list from disk. [] if missing/unreadable."""
    if not os.path.exists(MINIWAR_DATA_FILE):
        return []
    try:
        with open(MINIWAR_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        return []


def _save_miniwar_scores(scores):
    """Write Mini War scores atomically-ish (write temp, then replace)."""
    tmp = MINIWAR_DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MINIWAR_DATA_FILE)


def _miniwar_rank_key(entry):
    """Best first: HIGHEST score wins; tie → earliest submission."""
    return (-int(entry.get("score", 0) or 0), int(entry.get("ts", 0) or 0))


def _miniwar_top(scores, n=TOP_N):
    return sorted(scores, key=_miniwar_rank_key)[:n]


def _load_miniwar_visits():
    """Read the Mini War visit count. 0 if missing/unreadable."""
    if not os.path.exists(MINIWAR_VISITS_FILE):
        return 0
    try:
        with open(MINIWAR_VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        return 0


def _save_miniwar_visits(visits):
    """Write the Mini War visit count atomically-ish."""
    tmp = MINIWAR_VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MINIWAR_VISITS_FILE)


@app.route("/api/miniwar/leaderboard", methods=["GET", "OPTIONS"])
def api_miniwar_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _miniwar_lock:
        board = _miniwar_top(_load_miniwar_scores())
    return jsonify({"scores": board})


@app.route("/api/miniwar/visit", methods=["POST", "OPTIONS"])
def api_miniwar_visit():
    """Increment the Mini War visit counter by exactly one."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _miniwar_visits_lock:
        visits = _load_miniwar_visits() + 1
        _save_miniwar_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/miniwar/visits", methods=["GET", "OPTIONS"])
def api_miniwar_visits():
    """Return the Mini War visit count WITHOUT incrementing."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _miniwar_visits_lock:
        visits = _load_miniwar_visits()
    return jsonify({"visits": visits})


@app.route("/api/miniwar/score", methods=["POST", "OPTIONS"])
def api_miniwar_score():
    if request.method == "OPTIONS":
        return ("", 204)

    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        name = _clean_name(payload.get("name"))
        score = _clean_int(payload.get("score"), MAX_MINIWAR_SCORE)
        wave = _clean_int(payload.get("wave", 0), MAX_MINIWAR_WAVE)
        replace = payload.get("replace") is True
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid score payload"}), 400

    entry = {
        "name": name,
        "score": score,
        "wave": wave,
        "ts": int(time.time() * 1000),
    }

    with _miniwar_lock:
        scores = _load_miniwar_scores()
        norm = _normalize_name(name)
        if replace:
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        scores = _miniwar_top(scores, MAX_STORED)
        _save_miniwar_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# ===========================================================================
# Player accounts — sign up / log in, with saved per-player progress so a
# player's Mini War progress follows them across devices. Passwords are NEVER
# stored in plain text: we keep a per-user random salt and a PBKDF2-HMAC-SHA256
# hash. A login returns a random session token (kept in the browser's
# localStorage) that authenticates progress save/load. This is the SITE'S OWN
# account system — it has nothing to do with any other website's accounts.
# ===========================================================================
ACCOUNTS_FILE = os.path.join(PROJECT_DIR, "accounts.json")

MIN_USERNAME_LEN = 2
MIN_PASSWORD_LEN = 4
MAX_PASSWORD_LEN = 128
PBKDF2_ROUNDS = 120000

# The saved in-progress game ("run") snapshot we let an account hold so a player
# can resume across devices. It's an arbitrary JSON object, but we cap its
# serialized size so a bad/huge payload can't bloat the accounts file. The whole
# progress POST body is already capped at ~10 KB, so this leaves room for the
# token + the bestScore/bestWave numbers alongside the run.
MAX_RUN_BYTES = 8 * 1024

_accounts_lock = threading.Lock()


def _load_accounts():
    """Read the accounts map {normalized_name: record}. {} if missing/bad."""
    if not os.path.exists(ACCOUNTS_FILE):
        return {}
    try:
        with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        users = data.get("users", {}) if isinstance(data, dict) else {}
        return users if isinstance(users, dict) else {}
    except (ValueError, OSError):
        return {}


def _save_accounts(users):
    """Write the accounts map atomically-ish (write temp, then replace)."""
    tmp = ACCOUNTS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ACCOUNTS_FILE)


def _hash_password(password, salt_hex):
    """PBKDF2-HMAC-SHA256 of the password with the given hex salt → hex digest."""
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ROUNDS
    )
    return dk.hex()


def _new_token():
    return secrets.token_hex(24)


def _clean_progress(raw):
    """Keep only known progress fields, each bounded. Always a dict.

    Two kinds of fields are accepted:
      • bestScore / bestWave — monotonic high-water numbers (bounded ints).
      • run — the full saved-game snapshot so a player can resume an
        in-progress game after logging in on another device. It must be a JSON
        object whose serialized size is small (<= MAX_RUN_BYTES); anything
        bigger or of the wrong type is ignored. `run: null` is allowed and is
        the explicit signal to CLEAR the saved run (e.g. on game over).
    """
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, cap in (("bestScore", MAX_MINIWAR_SCORE), ("bestWave", MAX_MINIWAR_WAVE)):
        if key in raw:
            try:
                out[key] = _clean_int(raw.get(key), cap)
            except (ValueError, TypeError):
                pass
    if "run" in raw:
        run = raw.get("run")
        if run is None:
            # Explicit "clear my saved run" — keep the signal so merge can act.
            out["run"] = None
        elif isinstance(run, dict):
            try:
                serialized = json.dumps(run, ensure_ascii=False)
            except (TypeError, ValueError):
                serialized = None
            if serialized is not None and len(serialized.encode("utf-8")) <= MAX_RUN_BYTES:
                out["run"] = run
            # Too big or unserializable → silently ignore, leaving any
            # previously stored run untouched.
    return out


def _merge_progress(old, new):
    """Merge new progress into old.

    bestScore/bestWave only ever GROW (we keep the max). The saved `run`
    snapshot is REPLACED with whatever the client just sent, or CLEARED when
    the client sends run=None. Old account records that never had a `run`
    simply gain (or don't gain) one — fully backward compatible.
    """
    merged = dict(old or {})
    for key, val in (new or {}).items():
        if key == "run":
            if val is None:
                merged.pop("run", None)   # explicit clear (e.g. game over)
            else:
                merged["run"] = val        # replace with the latest snapshot
            continue
        try:
            merged[key] = max(int(merged.get(key, 0) or 0), int(val or 0))
        except (ValueError, TypeError):
            merged[key] = val
    return merged


def _find_user_by_token(users, token):
    """Return (norm_key, record) for the account holding `token`, or (None, None)."""
    if not token or not isinstance(token, str):
        return (None, None)
    for norm, rec in users.items():
        if isinstance(rec, dict) and rec.get("token") == token:
            return (norm, rec)
    return (None, None)


def _read_credentials():
    """Pull (name, password) from the request body, validating shape/size.

    Returns (name, password) on success, or (None, error_response) on failure.
    """
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return (None, (jsonify({"error": "bad request"}), 400))
    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
    except (ValueError, UnicodeDecodeError, TypeError):
        return (None, (jsonify({"error": "invalid payload"}), 400))

    name = _clean_name(payload.get("username"))
    password = payload.get("password")
    if not isinstance(password, str):
        return (None, (jsonify({"error": "invalid payload"}), 400))
    return ((name, password), None)


@app.route("/api/account/register", methods=["POST", "OPTIONS"])
def api_account_register():
    if request.method == "OPTIONS":
        return ("", 204)

    creds, err = _read_credentials()
    if err:
        return err
    name, password = creds

    if len(name) < MIN_USERNAME_LEN:
        return jsonify({"error": "bad_username",
                        "message": "Pick a username with at least 2 characters."}), 400
    if not (MIN_PASSWORD_LEN <= len(password) <= MAX_PASSWORD_LEN):
        return jsonify({"error": "bad_password",
                        "message": "Password must be at least 4 characters."}), 400

    norm = _normalize_name(name)
    with _accounts_lock:
        users = _load_accounts()
        if norm in users:
            return jsonify({"error": "name_taken",
                            "message": "That username is taken — try another."}), 409
        salt = secrets.token_hex(16)
        token = _new_token()
        users[norm] = {
            "name": name,
            "salt": salt,
            "hash": _hash_password(password, salt),
            "token": token,
            "progress": {},
            "ts": int(time.time() * 1000),
        }
        _save_accounts(users)

    return jsonify({"token": token, "username": name, "progress": {}})


@app.route("/api/account/login", methods=["POST", "OPTIONS"])
def api_account_login():
    if request.method == "OPTIONS":
        return ("", 204)

    creds, err = _read_credentials()
    if err:
        return err
    name, password = creds
    norm = _normalize_name(name)

    with _accounts_lock:
        users = _load_accounts()
        rec = users.get(norm)
        # Constant-ish behavior: same error whether the user is missing or the
        # password is wrong, so we don't leak which usernames exist.
        if not isinstance(rec, dict) or not rec.get("salt") or not rec.get("hash"):
            return jsonify({"error": "bad_login",
                            "message": "Wrong username or password."}), 401
        if not secrets.compare_digest(_hash_password(password, rec["salt"]), rec["hash"]):
            return jsonify({"error": "bad_login",
                            "message": "Wrong username or password."}), 401
        token = _new_token()
        rec["token"] = token
        _save_accounts(users)
        progress = rec.get("progress", {}) or {}
        display = rec.get("name", name)

    return jsonify({"token": token, "username": display, "progress": progress})


@app.route("/api/account/progress", methods=["GET", "POST", "OPTIONS"])
def api_account_progress():
    if request.method == "OPTIONS":
        return ("", 204)

    if request.method == "GET":
        token = request.args.get("token", "")
        with _accounts_lock:
            users = _load_accounts()
            norm, rec = _find_user_by_token(users, token)
            if not rec:
                return jsonify({"error": "unauthorized"}), 401
            return jsonify({"username": rec.get("name"),
                            "progress": rec.get("progress", {}) or {}})

    # POST: save (merge) progress for the account holding this token.
    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400
    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid payload"}), 400

    token = payload.get("token", "")
    incoming = _clean_progress(payload.get("progress"))
    with _accounts_lock:
        users = _load_accounts()
        norm, rec = _find_user_by_token(users, token)
        if not rec:
            return jsonify({"error": "unauthorized"}), 401
        rec["progress"] = _merge_progress(rec.get("progress", {}), incoming)
        _save_accounts(users)
        return jsonify({"username": rec.get("name"), "progress": rec["progress"]})


# ===========================================================================
# 2048 — classic merge-tile puzzle. Leaderboard is HIGHEST score first
# (score = points earned by merging tiles).
# ===========================================================================
GAME2048_DATA_FILE = os.path.join(PROJECT_DIR, "2048_leaderboard.json")
GAME2048_VISITS_FILE = os.path.join(PROJECT_DIR, "2048_visits.json")

# Score is generous; junk input can't store an absurd number.
MAX_2048_SCORE = 100000000

_game2048_lock = threading.Lock()
_game2048_visits_lock = threading.Lock()


def _load_2048_scores():
    """Read the 2048 score list from disk. [] if missing/unreadable."""
    if not os.path.exists(GAME2048_DATA_FILE):
        return []
    try:
        with open(GAME2048_DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        scores = data.get("scores", []) if isinstance(data, dict) else []
        return scores if isinstance(scores, list) else []
    except (ValueError, OSError):
        return []


def _save_2048_scores(scores):
    """Write 2048 scores atomically-ish (write temp, then replace)."""
    tmp = GAME2048_DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"scores": scores}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, GAME2048_DATA_FILE)


def _game2048_rank_key(entry):
    """Best first: HIGHEST score wins; tie → earliest submission."""
    return (-int(entry.get("score", 0) or 0), int(entry.get("ts", 0) or 0))


def _game2048_top(scores, n=TOP_N):
    return sorted(scores, key=_game2048_rank_key)[:n]


def _load_2048_visits():
    """Read the 2048 visit count. 0 if missing/unreadable."""
    if not os.path.exists(GAME2048_VISITS_FILE):
        return 0
    try:
        with open(GAME2048_VISITS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        visits = data.get("visits", 0) if isinstance(data, dict) else 0
        visits = int(visits)
        return visits if visits >= 0 else 0
    except (ValueError, TypeError, OSError):
        return 0


def _save_2048_visits(visits):
    """Write the 2048 visit count atomically-ish."""
    tmp = GAME2048_VISITS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"visits": int(visits)}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, GAME2048_VISITS_FILE)


@app.route("/api/2048/leaderboard", methods=["GET", "OPTIONS"])
def api_2048_leaderboard():
    if request.method == "OPTIONS":
        return ("", 204)
    with _game2048_lock:
        board = _game2048_top(_load_2048_scores())
    return jsonify({"scores": board})


@app.route("/api/2048/visit", methods=["POST", "OPTIONS"])
def api_2048_visit():
    """Increment the 2048 visit counter by exactly one."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _game2048_visits_lock:
        visits = _load_2048_visits() + 1
        _save_2048_visits(visits)
    return jsonify({"visits": visits})


@app.route("/api/2048/visits", methods=["GET", "OPTIONS"])
def api_2048_visits():
    """Return the 2048 visit count WITHOUT incrementing."""
    if request.method == "OPTIONS":
        return ("", 204)
    with _game2048_visits_lock:
        visits = _load_2048_visits()
    return jsonify({"visits": visits})


@app.route("/api/2048/score", methods=["POST", "OPTIONS"])
def api_2048_score():
    if request.method == "OPTIONS":
        return ("", 204)

    raw = request.get_data(cache=False) or b""
    if len(raw) <= 0 or len(raw) > 10000:
        return jsonify({"error": "bad request"}), 400

    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
        name = _clean_name(payload.get("name"))
        score = _clean_int(payload.get("score"), MAX_2048_SCORE)
        replace = payload.get("replace") is True
    except (ValueError, UnicodeDecodeError, TypeError):
        return jsonify({"error": "invalid score payload"}), 400

    entry = {
        "name": name,
        "score": score,
        "ts": int(time.time() * 1000),
    }

    with _game2048_lock:
        scores = _load_2048_scores()
        norm = _normalize_name(name)
        if replace:
            scores = [e for e in scores if _normalize_name(e.get("name")) != norm]
        elif any(_normalize_name(e.get("name")) == norm for e in scores):
            return (
                jsonify(
                    {
                        "error": "name_taken",
                        "message": "That name is already taken — choose a different one.",
                    }
                ),
                409,
            )
        scores.append(entry)
        scores = _game2048_top(scores, MAX_STORED)
        _save_2048_scores(scores)
        board = scores[:TOP_N]

    return jsonify({"scores": board})


# Make sure the storage file exists so the first GET returns a real list.
if not os.path.exists(DATA_FILE):
    try:
        _save_scores([])
    except OSError:
        pass

# Same for the visit counter, so the first GET returns a real number.
if not os.path.exists(VISITS_FILE):
    try:
        _save_visits(0)
    except OSError:
        pass

# Chess storage files, created the same way so the first GETs work.
if not os.path.exists(CHESS_DATA_FILE):
    try:
        _save_chess_scores([])
    except OSError:
        pass

if not os.path.exists(CHESS_VISITS_FILE):
    try:
        _save_chess_visits(0)
    except OSError:
        pass

# Flappy storage files, created the same way so the first GETs work.
if not os.path.exists(FLAPPY_DATA_FILE):
    try:
        _save_flappy_scores([])
    except OSError:
        pass

if not os.path.exists(FLAPPY_VISITS_FILE):
    try:
        _save_flappy_visits(0)
    except OSError:
        pass

# Minesweeper storage files, created the same way so the first GETs work.
if not os.path.exists(MINES_DATA_FILE):
    try:
        _save_mines_scores([])
    except OSError:
        pass

if not os.path.exists(MINES_VISITS_FILE):
    try:
        _save_mines_visits(0)
    except OSError:
        pass

# Breakout storage files, created the same way so the first GETs work.
if not os.path.exists(BREAKOUT_DATA_FILE):
    try:
        _save_breakout_scores([])
    except OSError:
        pass

if not os.path.exists(BREAKOUT_VISITS_FILE):
    try:
        _save_breakout_visits(0)
    except OSError:
        pass

# Mini War storage files, created the same way so the first GETs work.
if not os.path.exists(MINIWAR_DATA_FILE):
    try:
        _save_miniwar_scores([])
    except OSError:
        pass

if not os.path.exists(MINIWAR_VISITS_FILE):
    try:
        _save_miniwar_visits(0)
    except OSError:
        pass

# Accounts store, created empty so the first login/register works.
if not os.path.exists(ACCOUNTS_FILE):
    try:
        _save_accounts({})
    except OSError:
        pass

# 2048 storage files, created the same way so the first GETs work.
if not os.path.exists(GAME2048_DATA_FILE):
    try:
        _save_2048_scores([])
    except OSError:
        pass

if not os.path.exists(GAME2048_VISITS_FILE):
    try:
        _save_2048_visits(0)
    except OSError:
        pass


if __name__ == "__main__":
    # Local convenience only. PythonAnywhere does NOT use this block — it imports
    # the `app` object directly via the WSGI config. Run locally with:
    #   python3 flask_app.py
    port = int(os.environ.get("PORT", "8787"))
    host = os.environ.get("HOST", "127.0.0.1")
    app.run(host=host, port=port)
