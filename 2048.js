/* 2048 — classic merge-tile puzzle for Fun Games.
   Arrow keys, WASD, and swipe. Higher score is better.
   Pure vanilla JS — no libraries. */

(() => {
  "use strict";

  const SIZE = 4;
  const WIN_TILE = 2048;
  const MOVE_MS = 120; // match CSS transition

  // ---- DOM ----------------------------------------------------------------
  const boardEl = document.getElementById("board");
  const tilesEl = document.getElementById("tiles");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayScore = document.getElementById("overlay-score");
  const startBtn = document.getElementById("start-btn");
  const keepGoingBtn = document.getElementById("keep-going-btn");
  const newBtn = document.getElementById("new-btn");

  const submitRow = document.getElementById("submit-row");
  const nameInput = document.getElementById("name-input");
  const submitBtn = document.getElementById("submit-btn");
  const submitStatus = document.getElementById("submit-status");
  const lbList = document.getElementById("lb-list");
  const lbNote = document.getElementById("lb-note");
  const visitsCountEl = document.getElementById("visits-count");

  const replaceConfirm = document.getElementById("replace-confirm");
  const replaceWelcome = document.getElementById("replace-welcome");
  const replacePrev = document.getElementById("replace-prev");
  const replaceThis = document.getElementById("replace-this");
  const replaceVerdict = document.getElementById("replace-verdict");
  const replaceYes = document.getElementById("replace-yes");
  const replaceNo = document.getElementById("replace-no");

  // ---- Game state ---------------------------------------------------------
  // Each tile: { id, value, row, col, mergedFrom? }
  let tiles = [];
  let nextId = 1;
  let score = 0;
  let best = Number(localStorage.getItem("game2048Best") || 0);
  let running = false;
  let won = false;          // reached 2048 at least once this run
  let keepGoing = false;    // player chose to continue after winning
  let gameOver = false;
  let animating = false;
  let scoreSubmitted = false;
  let cellSize = 0;
  let gap = 10;

  bestEl.textContent = best;

  // ---- Helpers ------------------------------------------------------------
  function emptyCells() {
    const taken = new Set(tiles.map((t) => t.row * SIZE + t.col));
    const free = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!taken.has(r * SIZE + c)) free.push({ row: r, col: c });
      }
    }
    return free;
  }

  function spawnTile() {
    const free = emptyCells();
    if (!free.length) return null;
    const spot = free[Math.floor(Math.random() * free.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    const tile = {
      id: nextId++,
      value,
      row: spot.row,
      col: spot.col,
      isNew: true,
    };
    tiles.push(tile);
    return tile;
  }

  function tileAt(row, col) {
    return tiles.find((t) => t.row === row && t.col === col) || null;
  }

  function measureBoard() {
    const style = getComputedStyle(boardEl);
    gap = parseFloat(style.getPropertyValue("--gap")) || 10;
    const inner = boardEl.clientWidth - gap * 2;
    cellSize = (inner - gap * (SIZE - 1)) / SIZE;
  }

  function tileClass(value) {
    if (value <= 2048) return "tile-" + value;
    return "tile-super";
  }

  function valueFontScale(value) {
    if (value >= 1000) return 0.32;
    if (value >= 100) return 0.38;
    return 0.45;
  }

  function renderTiles() {
    measureBoard();
    // Keep existing DOM nodes when possible so CSS transitions can run.
    const existing = new Map();
    Array.from(tilesEl.children).forEach((el) => {
      existing.set(Number(el.dataset.id), el);
    });

    const keepIds = new Set(tiles.map((t) => t.id));

    // Remove tiles that are gone (merged away).
    existing.forEach((el, id) => {
      if (!keepIds.has(id)) el.remove();
    });

    tiles.forEach((t) => {
      let el = existing.get(t.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "tile " + tileClass(t.value);
        el.dataset.id = String(t.id);
        el.textContent = String(t.value);
        tilesEl.appendChild(el);
      } else {
        el.className = "tile " + tileClass(t.value);
        el.textContent = String(t.value);
      }

      const x = t.col * (cellSize + gap);
      const y = t.row * (cellSize + gap);
      el.style.width = cellSize + "px";
      el.style.height = cellSize + "px";
      el.style.fontSize =
        Math.max(14, Math.floor(cellSize * valueFontScale(t.value))) + "px";
      el.style.setProperty("--x", x + "px");
      el.style.setProperty("--y", y + "px");

      if (t.isNew) {
        el.classList.add("new");
        t.isNew = false;
      } else {
        el.classList.remove("new");
      }
      if (t.justMerged) {
        el.classList.add("merged");
        t.justMerged = false;
      } else {
        el.classList.remove("merged");
      }
    });
  }

  // ---- Move logic ---------------------------------------------------------
  // Slide one line (array of tiles) toward the start. Returns { line, gained, moved }.
  function slideLine(line) {
    // line is length SIZE, with nulls for empty cells, already ordered
    // so index 0 is the "wall" we slide toward.
    const compact = line.filter(Boolean);
    const result = [];
    let gained = 0;
    let moved = false;
    let i = 0;
    while (i < compact.length) {
      const a = compact[i];
      const b = compact[i + 1];
      if (b && a.value === b.value) {
        // Keep tile a's id so it can slide, then pop as the merge.
        const merged = {
          id: a.id,
          value: a.value * 2,
          row: a.row,
          col: a.col,
          justMerged: true,
        };
        gained += merged.value;
        result.push(merged);
        moved = true;
        i += 2;
      } else {
        result.push(a);
        i += 1;
      }
    }
    while (result.length < SIZE) result.push(null);

    // Detect position changes (including merges).
    for (let k = 0; k < SIZE; k++) {
      const before = line[k];
      const after = result[k];
      if (before !== after) moved = true;
    }
    return { line: result, gained, moved };
  }

  function getLine(dir, index) {
    // Returns tiles in slide order (first = toward the wall).
    const out = [];
    for (let i = 0; i < SIZE; i++) {
      let r, c;
      if (dir === "left")  { r = index; c = i; }
      if (dir === "right") { r = index; c = SIZE - 1 - i; }
      if (dir === "up")    { r = i; c = index; }
      if (dir === "down")  { r = SIZE - 1 - i; c = index; }
      out.push(tileAt(r, c));
    }
    return out;
  }

  function setLinePositions(dir, index, line) {
    for (let i = 0; i < SIZE; i++) {
      const t = line[i];
      if (!t) continue;
      if (dir === "left")  { t.row = index; t.col = i; }
      if (dir === "right") { t.row = index; t.col = SIZE - 1 - i; }
      if (dir === "up")    { t.row = i; t.col = index; }
      if (dir === "down")  { t.row = SIZE - 1 - i; t.col = index; }
    }
  }

  function move(dir) {
    if (!running || gameOver || animating) return;
    // Don't move while the win overlay is up (unless they already chose keep going).
    if (won && !keepGoing && !overlay.classList.contains("hidden")) return;

    let anyMoved = false;
    let gained = 0;
    const survivors = [];

    for (let index = 0; index < SIZE; index++) {
      const before = getLine(dir, index);
      const { line, gained: g, moved } = slideLine(before);
      if (moved) anyMoved = true;
      gained += g;
      setLinePositions(dir, index, line);
      line.forEach((t) => { if (t) survivors.push(t); });
    }

    if (!anyMoved) return;

    tiles = survivors;
    score += gained;
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      localStorage.setItem("game2048Best", String(best));
    }

    // First paint: slide existing tiles to new spots.
    renderTiles();
    animating = true;

    window.setTimeout(() => {
      spawnTile();
      renderTiles();
      animating = false;

      // Check for first-time win this run.
      if (!won && tiles.some((t) => t.value >= WIN_TILE)) {
        won = true;
        showWin();
        return;
      }

      if (!canMove()) {
        endGame();
      }
    }, MOVE_MS);
  }

  function canMove() {
    if (emptyCells().length > 0) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = tileAt(r, c);
        if (!t) return true;
        const right = tileAt(r, c + 1);
        const down = tileAt(r + 1, c);
        if (right && right.value === t.value) return true;
        if (down && down.value === t.value) return true;
      }
    }
    return false;
  }

  // ---- Game flow ----------------------------------------------------------
  function resetBoard() {
    tiles = [];
    nextId = 1;
    score = 0;
    scoreEl.textContent = "0";
    won = false;
    keepGoing = false;
    gameOver = false;
    scoreSubmitted = false;
    animating = false;
    spawnTile();
    spawnTile();
    renderTiles();
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function showOverlay() {
    overlay.classList.remove("hidden");
  }

  function startGame() {
    resetBoard();
    running = true;
    submitRow.hidden = true;
    replaceConfirm.hidden = true;
    keepGoingBtn.hidden = true;
    overlayScore.hidden = true;
    submitStatus.hidden = true;
    startBtn.textContent = "Play Again";
    hideOverlay();
  }

  function showWin() {
    overlayTitle.textContent = "You made 2048! 🎉";
    overlayText.textContent =
      "Awesome! You can keep playing for a higher score, or start a new game.";
    overlayScore.hidden = false;
    overlayScore.textContent = "Score: " + score;
    submitRow.hidden = true;
    replaceConfirm.hidden = true;
    keepGoingBtn.hidden = false;
    startBtn.textContent = "New Game";
    startBtn.hidden = false;
    showOverlay();
  }

  function endGame() {
    gameOver = true;
    running = false;
    overlayTitle.textContent = "Game Over";
    overlayText.textContent =
      "No more moves! Submit your score to the global board, or try again.";
    overlayScore.hidden = false;
    overlayScore.textContent = "Score: " + score;
    keepGoingBtn.hidden = true;
    startBtn.textContent = "Play Again";
    startBtn.hidden = false;

    // Ready the score form (same pattern as Breakout).
    scoreSubmitted = false;
    submitRow.hidden = false;
    replaceConfirm.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit score";
    submitStatus.hidden = true;
    nameInput.value = localStorage.getItem("zooSnakeName") || "";

    showOverlay();
  }

  // ---- Controls -----------------------------------------------------------
  const KEY_DIR = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", W: "up", s: "down", S: "down", a: "left", A: "left", d: "right", D: "right",
  };

  window.addEventListener("keydown", (e) => {
    if (document.activeElement === nameInput) return;
    const dir = KEY_DIR[e.key];
    if (!dir) return;
    e.preventDefault();
    if (!running && !gameOver && overlay.classList.contains("hidden") === false) {
      // On the start screen, first arrow starts the game then moves.
      startGame();
    }
    move(dir);
  });

  // Swipe / touch
  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_MIN = 24;

  boardEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  boardEl.addEventListener("touchend", (e) => {
    if (!e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    let dir;
    if (Math.abs(dx) > Math.abs(dy)) {
      dir = dx > 0 ? "right" : "left";
    } else {
      dir = dy > 0 ? "down" : "up";
    }
    if (!running && !gameOver) startGame();
    move(dir);
  }, { passive: true });

  startBtn.addEventListener("click", () => {
    startGame();
  });

  keepGoingBtn.addEventListener("click", () => {
    keepGoing = true;
    keepGoingBtn.hidden = true;
    hideOverlay();
  });

  newBtn.addEventListener("click", () => {
    startGame();
  });

  window.addEventListener("resize", () => {
    renderTiles();
  });

  // ===================================================================
  // Global leaderboard — HIGHEST score first
  // ===================================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  let highlight = null;
  let currentScores = [];

  function rankCompare(a, b) {
    const ds = (Number(a.score) || 0) - (Number(b.score) || 0);
    if (ds !== 0) return ds;
    return (Number(b.ts) || 0) - (Number(a.ts) || 0);
  }

  function collapseScores(scores) {
    const bestByName = new Map();
    scores.forEach((s) => {
      const key = normalizeName(s.name);
      const prev = bestByName.get(key);
      if (!prev) {
        bestByName.set(key, s);
        return;
      }
      const cmp = rankCompare(s, prev);
      if (cmp > 0) {
        bestByName.set(key, s);
      } else if (cmp === 0 && (Number(s.ts) || 0) < (Number(prev.ts) || 0)) {
        bestByName.set(key, s);
      }
    });
    return Array.from(bestByName.values()).sort((a, b) => rankCompare(b, a));
  }

  function renderLeaderboard(scores) {
    const collapsed = collapseScores(Array.isArray(scores) ? scores : []);
    currentScores = collapsed;
    lbList.innerHTML = "";
    if (!collapsed.length) {
      lbNote.textContent = "No scores yet — be the first! 🔢";
      lbNote.hidden = false;
      return;
    }
    lbNote.hidden = true;
    collapsed.slice(0, 20).forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      if (highlight && s.name === highlight.name && s.score === highlight.score) {
        li.classList.add("you");
      }
      li.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(s.name)}</span>` +
        `<span class="lb-score">${Number(s.score) || 0}</span>`;
      lbList.appendChild(li);
    });
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/2048/leaderboard", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      renderLeaderboard(Array.isArray(data.scores) ? data.scores : []);
    } catch (err) {
      lbNote.textContent = "Couldn't load leaderboard.";
      lbNote.hidden = false;
    }
  }

  function nameIsTaken(name) {
    const norm = normalizeName(name);
    return currentScores.some((s) => normalizeName(s.name) === norm);
  }

  function bestEntryForName(name) {
    const norm = normalizeName(name);
    return currentScores.find((s) => normalizeName(s.name) === norm) || null;
  }

  function runIsHigher(run, prev) {
    return (Number(run.score) || 0) > (Number(prev.score) || 0);
  }

  function showNameTaken() {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit score";
    submitStatus.textContent =
      "🚫 That name is already taken — please choose a different one.";
    submitStatus.className = "submit-status taken";
    submitStatus.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  function showReplaceConfirm(name, prevEntry) {
    submitRow.hidden = true;
    submitStatus.hidden = true;

    const higher = runIsHigher({ score }, prevEntry);
    replaceWelcome.textContent = `Welcome back, ${name}!`;
    replacePrev.textContent = `Your best: ${Number(prevEntry.score) || 0}`;
    replaceThis.textContent = `This run: ${score}`;

    if (higher) {
      replaceVerdict.textContent = "New high score! 🎉";
      replaceVerdict.className = "replace-verdict win";
      replaceYes.textContent = "Replace my score";
    } else {
      replaceVerdict.textContent = "This run didn't beat your best.";
      replaceVerdict.className = "replace-verdict lose";
      replaceYes.textContent = "Replace anyway (lower)";
    }
    replaceConfirm.hidden = false;
    replaceYes.focus();
  }

  async function handleSubmitClick() {
    if (scoreSubmitted) return;

    const name = (nameInput.value || "").trim().slice(0, 16);
    if (!name) {
      submitStatus.textContent = "Please enter a name first.";
      submitStatus.className = "submit-status err";
      submitStatus.hidden = false;
      nameInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    submitStatus.hidden = true;
    await fetchLeaderboard();

    if (!nameIsTaken(name)) {
      localStorage.setItem("zooSnakeName", name);
      submitScore(name);
      return;
    }

    const ownName = normalizeName(localStorage.getItem("zooSnakeName"));
    if (ownName && normalizeName(name) === ownName) {
      const prevEntry = bestEntryForName(name);
      if (prevEntry) {
        showReplaceConfirm(name, prevEntry);
        return;
      }
      localStorage.setItem("zooSnakeName", name);
      submitScore(name);
      return;
    }

    showNameTaken();
  }

  async function submitScore(name, replace = false) {
    submitRow.hidden = false;
    replaceConfirm.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    submitStatus.hidden = true;

    const payload = { name, score, replace };
    try {
      const res = await fetch("/api/2048/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        showNameTaken();
        await fetchLeaderboard();
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      scoreSubmitted = true;
      localStorage.setItem("zooSnakeName", name);
      highlight = { name, score };
      renderLeaderboard(Array.isArray(data.scores) ? data.scores : []);
      submitStatus.textContent = replace
        ? "Updated your score! 🏆"
        : "Saved to the global board! 🏆";
      submitStatus.className = "submit-status ok";
      submitStatus.hidden = false;
      submitBtn.textContent = "Saved ✓";
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Try again";
      submitStatus.textContent = "Couldn't submit — check your connection.";
      submitStatus.className = "submit-status err";
      submitStatus.hidden = false;
    }
  }

  submitBtn.addEventListener("click", handleSubmitClick);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!scoreSubmitted) handleSubmitClick();
    }
  });

  replaceYes.addEventListener("click", () => {
    if (scoreSubmitted) return;
    const name = (nameInput.value || "").trim().slice(0, 16);
    if (!name) return;
    submitScore(name, true);
  });

  replaceNo.addEventListener("click", async () => {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit score";
    submitStatus.textContent = "Kept your old score.";
    submitStatus.className = "submit-status ok";
    submitStatus.hidden = false;
    await fetchLeaderboard();
  });

  // ===================================================================
  // Global visit counter
  // ===================================================================
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    const VISIT_KEY = "game2048Counted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(
        firstOnThisDevice ? "/api/2048/visit" : "/api/2048/visits",
        {
          method: firstOnThisDevice ? "POST" : "GET",
          cache: "no-store",
        }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (firstOnThisDevice) localStorage.setItem(VISIT_KEY, "1");
      showVisits(Number(data.visits));
    } catch (err) {
      showVisits(NaN);
    }
  }

  async function refreshVisits() {
    try {
      const res = await fetch("/api/2048/visits", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      showVisits(Number(data.visits));
    } catch (err) {
      /* keep whatever is shown */
    }
  }

  // ---- Boot ---------------------------------------------------------------
  // Show two starter tiles under the overlay so the board looks ready.
  resetBoard();
  running = false;
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000);
  initVisits();
  setInterval(refreshVisits, 30000);
})();
