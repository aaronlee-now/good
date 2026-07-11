/* Minesweeper — Fun Games.
   Classic Minesweeper themed to match the zoo games. First click is always
   safe, blank cells flood-fill. The leaderboard ranks PROGRESS: the most safe
   cells revealed wins (a full clear is the maximum), ties broken by the faster
   time, then earliest submission — per difficulty. You can submit a score on a
   win OR a loss. Pure vanilla JS, no dependencies, works as static files. */

(() => {
  "use strict";

  // ---- Difficulty presets ------------------------------------------------
  // rows x cols and mine count for each level. Hard is wide; the CSS board uses
  // square cells that scale to the stage width, and the board-wrap can scroll
  // horizontally on very small phones if the cells would otherwise vanish.
  const LEVELS = {
    easy: { rows: 9, cols: 9, mines: 10, maxStage: 460 },
    medium: { rows: 16, cols: 16, mines: 40, maxStage: 560 },
    hard: { rows: 16, cols: 30, mines: 99, maxStage: 760 },
  };

  // ---- DOM ---------------------------------------------------------------
  const boardEl = document.getElementById("board");
  const stageEl = document.getElementById("stage");
  const statusEl = document.getElementById("status");
  const mineCountEl = document.getElementById("mine-count");
  const timeCountEl = document.getElementById("time-count");
  const difficultyEl = document.getElementById("difficulty");
  const newGameBtn = document.getElementById("new-game-btn");
  const flagToggleBtn = document.getElementById("flag-toggle");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayScore = document.getElementById("overlay-score");
  const overlayNewBtn = document.getElementById("overlay-new-btn");

  const submitRow = document.getElementById("submit-row");
  const nameInput = document.getElementById("name-input");
  const submitBtn = document.getElementById("submit-btn");
  const submitStatus = document.getElementById("submit-status");

  const replaceConfirm = document.getElementById("replace-confirm");
  const replaceWelcome = document.getElementById("replace-welcome");
  const replacePrev = document.getElementById("replace-prev");
  const replaceThis = document.getElementById("replace-this");
  const replaceVerdict = document.getElementById("replace-verdict");
  const replaceYes = document.getElementById("replace-yes");
  const replaceNo = document.getElementById("replace-no");

  const lbList = document.getElementById("lb-list");
  const lbNote = document.getElementById("lb-note");
  const lbSub = document.getElementById("lb-sub");
  const visitsCountEl = document.getElementById("visits-count");

  // ---- Game state --------------------------------------------------------
  let rows = 9;
  let cols = 9;
  let mineCount = 10;
  let grid = [];        // grid[r][c] = { mine, revealed, flagged, adj }
  let cellEls = [];     // cellEls[r][c] = the DOM element for that cell
  let minesPlaced = false;
  let flagsUsed = 0;
  let revealedCount = 0;
  let gameState = "ready"; // "ready" | "playing" | "won" | "lost"
  let flagMode = false;     // touch-only: taps place flags instead of revealing

  // Timer — whole seconds is the leaderboard metric.
  let timerId = null;
  let startTime = 0;
  let elapsedSec = 0;

  // Captured at the moment a round ends (win OR loss) so a later difficulty
  // change can't alter the values we submit. The ranking metric is now how many
  // safe cells were revealed; time is the tie-breaker.
  let endTime = 0;          // elapsed seconds when the round ended
  let endDifficulty = "easy";
  let endRevealed = 0;      // safe cells revealed at game-end
  let endTotal = 0;         // total safe cells on that board (max reveal)
  let endWon = false;       // true only on a full clear

  const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

  // ---- Build / reset -----------------------------------------------------
  function newGame() {
    const level = LEVELS[difficultyEl.value] || LEVELS.easy;
    rows = level.rows;
    cols = level.cols;
    mineCount = level.mines;
    stageEl.style.maxWidth = level.maxStage + "px";

    grid = [];
    cellEls = [];
    minesPlaced = false;
    flagsUsed = 0;
    revealedCount = 0;
    gameState = "ready";
    stopTimer();
    elapsedSec = 0;
    updateTimeDisplay();
    updateMineDisplay();

    overlay.classList.add("hidden");
    submitStatus.hidden = true;
    replaceConfirm.hidden = true;

    buildBoard();
    setStatus("Tap or click a cell to start.", "");
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let r = 0; r < rows; r++) {
      const gridRow = [];
      const elRow = [];
      for (let c = 0; c < cols; c++) {
        gridRow.push({ mine: false, revealed: false, flagged: false, adj: 0 });
        const div = document.createElement("div");
        div.className = "cell";
        div.dataset.r = String(r);
        div.dataset.c = String(c);
        boardEl.appendChild(div);
        elRow.push(div);
      }
      grid.push(gridRow);
      cellEls.push(elRow);
    }
    fitBoard();
  }

  // Scale the number/emoji font to the live cell size so it's readable on every
  // board size (Easy's big cells down to Hard's small ones).
  function fitBoard() {
    const cellPx = boardEl.clientWidth / cols;
    boardEl.style.fontSize = Math.max(8, Math.floor(cellPx * 0.56)) + "px";
  }
  window.addEventListener("resize", fitBoard);

  // ---- Mine placement (first-click safe) ---------------------------------
  // Place mines AFTER the first reveal, never on the clicked cell or any of its
  // 8 neighbors, so the first click always opens a safe (ideally blank) area.
  function placeMines(safeR, safeC) {
    const forbidden = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        forbidden.add((safeR + dr) + "," + (safeC + dc));
      }
    }

    // If the board is too small to keep the whole neighborhood safe, fall back
    // to just protecting the clicked cell so we can still place every mine.
    const freeCells = rows * cols - forbidden.size;
    const useNeighborhood = freeCells >= mineCount;

    let placed = 0;
    while (placed < mineCount) {
      const r = (Math.random() * rows) | 0;
      const c = (Math.random() * cols) | 0;
      if (grid[r][c].mine) continue;
      if (r === safeR && c === safeC) continue;
      if (useNeighborhood && forbidden.has(r + "," + c)) continue;
      grid[r][c].mine = true;
      placed++;
    }

    // Count adjacent mines for every non-mine cell.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].mine) continue;
        let n = 0;
        forEachNeighbor(r, c, (nr, nc) => {
          if (grid[nr][nc].mine) n++;
        });
        grid[r][c].adj = n;
      }
    }
    minesPlaced = true;
  }

  function forEachNeighbor(r, c, fn) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) fn(nr, nc);
      }
    }
  }

  // ---- Reveal / flag -----------------------------------------------------
  function handleReveal(r, c) {
    if (gameState === "won" || gameState === "lost") return;
    const cell = grid[r][c];
    if (cell.revealed || cell.flagged) return;

    // First reveal starts the round (and lays the mines, keeping this cell safe).
    if (!minesPlaced) {
      placeMines(r, c);
      gameState = "playing";
      startTimer();
      setStatus("Good luck! 🍀", "");
    }

    if (cell.mine) {
      loseGame(r, c);
      return;
    }

    floodReveal(r, c);
    paintAll();

    if (revealedCount === rows * cols - mineCount) {
      winGame();
    }
  }

  // Reveal the cell; if it's a 0 (blank), flood-fill its connected blank region
  // and the numbered border around it (iterative stack, no recursion limits).
  function floodReveal(startR, startC) {
    const stack = [[startR, startC]];
    while (stack.length) {
      const [r, c] = stack.pop();
      const cell = grid[r][c];
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      revealedCount++;
      if (cell.adj === 0) {
        forEachNeighbor(r, c, (nr, nc) => {
          if (!grid[nr][nc].revealed) stack.push([nr, nc]);
        });
      }
    }
  }

  function toggleFlag(r, c) {
    if (gameState === "won" || gameState === "lost") return;
    const cell = grid[r][c];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    flagsUsed += cell.flagged ? 1 : -1;
    updateMineDisplay();
    paintCell(r, c);
  }

  // ---- Rendering ---------------------------------------------------------
  function paintCell(r, c) {
    const cell = grid[r][c];
    const el = cellEls[r][c];
    el.className = "cell";
    el.textContent = "";
    if (cell.flagged && !cell.revealed) {
      el.textContent = "🚩";
      el.classList.add("flagged");
      return;
    }
    if (!cell.revealed) return;
    el.classList.add("revealed");
    if (cell.mine) {
      el.textContent = "💣";
      return;
    }
    if (cell.adj > 0) {
      el.textContent = String(cell.adj);
      el.classList.add("n" + cell.adj);
    }
  }

  function paintAll() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) paintCell(r, c);
    }
  }

  function updateMineDisplay() {
    mineCountEl.textContent = String(Math.max(0, mineCount - flagsUsed));
  }

  function updateTimeDisplay() {
    timeCountEl.textContent = formatTime(elapsedSec);
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "status" + (cls ? " " + cls : "");
  }

  // ---- Timer -------------------------------------------------------------
  function startTimer() {
    startTime = Date.now();
    elapsedSec = 0;
    updateTimeDisplay();
    timerId = setInterval(() => {
      elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      updateTimeDisplay();
    }, 250);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // Whole seconds elapsed since the round started.
  function finalSeconds() {
    return Math.max(0, Math.floor((Date.now() - startTime) / 1000));
  }

  // ---- Win / lose --------------------------------------------------------
  // Capture the final, stable values for this round so a later difficulty
  // change can't alter what we submit.
  function captureEnd(won) {
    endTime = elapsedSec;
    endDifficulty = difficultyEl.value;
    endRevealed = revealedCount;
    endTotal = rows * cols - mineCount;
    endWon = won;
  }

  // Reset the score-submission UI inside the overlay (shared by win + loss).
  function openSubmitUI() {
    scoreSubmitted = false;
    submitStatus.hidden = true;
    submitStatus.className = "submit-status";
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit progress";
    submitRow.hidden = false;
    replaceConfirm.hidden = true;
    nameInput.value = localStorage.getItem("zooSnakeName") || "";
  }

  function loseGame(boomR, boomC) {
    gameState = "lost";
    stopTimer();
    elapsedSec = finalSeconds();
    updateTimeDisplay();
    captureEnd(false);

    // Reveal every mine and mark wrong flags.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.mine && !cell.flagged) cell.revealed = true;
        paintCell(r, c);
        if (cell.mine && cell.flagged) {
          // Correct flag — leave the flag showing.
        } else if (!cell.mine && cell.flagged) {
          cellEls[r][c].classList.add("wrong");
        }
      }
    }
    cellEls[boomR][boomC].classList.add("boom");

    setStatus("Boom! You hit a mine. 💥", "over");
    overlayTitle.textContent = "Boom! 💥";
    overlayText.textContent =
      "You revealed " + endRevealed + " of " + endTotal +
      " safe cells. Submit your progress to the board!";
    overlayScore.textContent =
      "Revealed " + endRevealed + "/" + endTotal + " · " + formatTime(endTime);

    // Losses still earn a spot on the progress board.
    openSubmitUI();
    overlay.classList.remove("hidden");
  }

  function winGame() {
    gameState = "won";
    stopTimer();
    elapsedSec = finalSeconds();
    updateTimeDisplay();
    captureEnd(true);

    // Auto-flag the remaining mines so the finished board looks tidy.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].mine && !grid[r][c].flagged) {
          grid[r][c].flagged = true;
          flagsUsed++;
        }
        paintCell(r, c);
      }
    }
    updateMineDisplay();

    setStatus("Cleared! 🏆", "win");
    overlayTitle.textContent = "Cleared! 🏆";
    overlayText.textContent =
      "You swept the " + LABELS[endDifficulty] +
      " field. Submit your run to the board!";
    overlayScore.textContent =
      "Cleared all " + endTotal + " cells in " + formatTime(endTime) + "! 🏆";

    openSubmitUI();
    overlay.classList.remove("hidden");
  }

  // ---- Input: desktop ----------------------------------------------------
  function coordsOf(el) {
    const cellEl = el.closest(".cell");
    if (!cellEl) return null;
    return { r: Number(cellEl.dataset.r), c: Number(cellEl.dataset.c) };
  }

  boardEl.addEventListener("click", (e) => {
    if (document.body.classList.contains("touch")) return; // touch path handles it
    const co = coordsOf(e.target);
    if (co) handleReveal(co.r, co.c);
  });

  // Right-click toggles a flag; always suppress the browser context menu here.
  boardEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const co = coordsOf(e.target);
    if (co) toggleFlag(co.r, co.c);
  });

  // ---- Input: touch (tap reveals, long-press flags) ----------------------
  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (isTouch) document.body.classList.add("touch");

  const LONG_PRESS_MS = 450;
  const MOVE_TOLERANCE = 12; // px of finger drift allowed before we cancel a tap
  let lpTimer = null;
  let lpCo = null;
  let lpFired = false;
  let lpStart = null;

  boardEl.addEventListener(
    "touchstart",
    (e) => {
      if (gameState === "won" || gameState === "lost") return;
      const co = coordsOf(e.target);
      if (!co) return;
      lpCo = co;
      lpFired = false;
      lpStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        lpFired = true;
        toggleFlag(co.r, co.c);
        if (navigator.vibrate) navigator.vibrate(25);
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchmove",
    (e) => {
      if (!lpStart) return;
      const dx = e.touches[0].clientX - lpStart.x;
      const dy = e.touches[0].clientY - lpStart.y;
      if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) {
        // Treat as a scroll/drag, not a tap — cancel the pending long-press.
        clearTimeout(lpTimer);
        lpCo = null;
      }
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchend",
    (e) => {
      clearTimeout(lpTimer);
      if (!lpCo) {
        lpStart = null;
        return;
      }
      e.preventDefault(); // stop the synthetic click + double-tap zoom
      const { r, c } = lpCo;
      lpCo = null;
      lpStart = null;
      if (lpFired) return; // long-press already toggled the flag
      if (flagMode) toggleFlag(r, c);
      else handleReveal(r, c);
    },
    { passive: false }
  );

  // Flag-mode toggle (touch only): taps place/remove flags while it's on.
  flagToggleBtn.addEventListener("click", () => {
    flagMode = !flagMode;
    flagToggleBtn.classList.toggle("active", flagMode);
    flagToggleBtn.setAttribute("aria-pressed", flagMode ? "true" : "false");
    flagToggleBtn.textContent = flagMode ? "🚩 Flag mode: ON" : "🚩 Flag mode";
  });

  // ---- New game / difficulty change --------------------------------------
  newGameBtn.addEventListener("click", newGame);
  overlayNewBtn.addEventListener("click", newGame);
  difficultyEl.addEventListener("change", () => {
    newGame();
    applyLeaderboard(); // re-filter the board to the newly selected difficulty
  });

  // ===================================================================
  // Global leaderboard — PROGRESS: most safe cells revealed (higher is better),
  // ties broken by faster time, then earliest ts — per difficulty.
  // ===================================================================
  let scoreSubmitted = false;
  let highlight = null;     // { name, revealed, time } of the row we just submitted
  let currentScores = [];   // collapsed board for the SELECTED difficulty
  let rawScores = [];       // last raw list from the server (all difficulties)

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // Positive if `a` ranks AHEAD of `b`: MORE cells revealed wins; tie → FASTER
  // (lower) time; tie → earlier ts.
  function rankCompare(a, b) {
    const dr = (Number(a.revealed) || 0) - (Number(b.revealed) || 0);
    if (dr !== 0) return dr;
    const dt = (Number(b.time) || 0) - (Number(a.time) || 0);
    if (dt !== 0) return dt;
    return (Number(b.ts) || 0) - (Number(a.ts) || 0);
  }

  // Collapse to ONE entry per normalized name, keeping each player's BEST
  // (most revealed, then fastest) run. Result is sorted best-first.
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

  // Render the leaderboard for whatever difficulty is currently selected.
  function applyLeaderboard() {
    const diff = difficultyEl.value;
    lbSub.textContent = LABELS[diff] || "Easy";
    const filtered = rawScores.filter(
      (s) => (s.difficulty || "easy") === diff
    );
    renderLeaderboard(filtered);
  }

  function renderLeaderboard(scores) {
    const collapsed = collapseScores(Array.isArray(scores) ? scores : []);
    currentScores = collapsed;
    lbList.innerHTML = "";
    if (!collapsed.length) {
      lbNote.textContent = "No runs yet — be the first! 🏆";
      lbNote.hidden = false;
      return;
    }
    lbNote.hidden = true;
    collapsed.slice(0, 20).forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      if (
        highlight &&
        s.name === highlight.name &&
        (Number(s.revealed) || 0) === highlight.revealed &&
        (Number(s.time) || 0) === highlight.time
      ) {
        li.classList.add("you");
      }
      const revealed = Number(s.revealed) || 0;
      const total = Number(s.total) || 0;
      // A full clear (win) gets a trophy and a winner color.
      const cleared = s.won === true || (total > 0 && revealed >= total);
      const progress = cleared
        ? `<span class="lb-cells clear">${revealed}/${total} 🏆</span>`
        : `<span class="lb-cells">${revealed}/${total}</span>`;
      li.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(s.name)}</span>` +
        progress +
        `<span class="lb-time">${formatTime(Number(s.time) || 0)}</span>`;
      lbList.appendChild(li);
    });
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/mines/leaderboard", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      rawScores = Array.isArray(data.scores) ? data.scores : [];
      applyLeaderboard();
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

  // "Better" = MORE cells revealed, or (same cells) a FASTER (strictly lower)
  // time. A full tie does NOT beat the old run.
  function runIsBetter(run, prev) {
    const rr = Number(run.revealed) || 0;
    const pr = Number(prev.revealed) || 0;
    if (rr !== pr) return rr > pr;
    return (Number(run.time) || 0) < (Number(prev.time) || 0);
  }

  function showNameTaken() {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit progress";
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

    const run = { revealed: endRevealed, time: endTime };
    const prevRevealed = Number(prevEntry.revealed) || 0;
    const moreCells = endRevealed > prevRevealed;
    const better = runIsBetter(run, prevEntry);
    replaceWelcome.textContent = `Welcome back, ${name}!`;
    replacePrev.textContent =
      `Your best: ${prevRevealed}/${Number(prevEntry.total) || 0} · ` +
      `${formatTime(Number(prevEntry.time) || 0)} (${prevEntry.difficulty || "?"})`;
    replaceThis.textContent =
      `This run: ${endRevealed}/${endTotal} · ${formatTime(endTime)} (${endDifficulty})`;

    if (better) {
      replaceVerdict.textContent = moreCells
        ? "New best — more cells! 🎉"
        : "New best — faster time! 🎉";
      replaceVerdict.className = "replace-verdict win";
      replaceYes.textContent = "Replace my score";
    } else {
      replaceVerdict.textContent = "This run didn't beat your best.";
      replaceVerdict.className = "replace-verdict lose";
      replaceYes.textContent = "Replace anyway";
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

    const payload = {
      name,
      revealed: endRevealed,
      total: endTotal,
      time: endTime,
      difficulty: endDifficulty,
      won: endWon,
      replace,
    };
    try {
      const res = await fetch("/api/mines/score", {
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
      highlight = { name, revealed: endRevealed, time: endTime };
      rawScores = Array.isArray(data.scores) ? data.scores : [];
      applyLeaderboard();
      submitStatus.textContent = replace
        ? "Updated your run! 🏆"
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
    submitBtn.textContent = "Submit progress";
    submitStatus.textContent = "Kept your old score.";
    submitStatus.className = "submit-status ok";
    submitStatus.hidden = false;
    await fetchLeaderboard();
  });

  // ===================================================================
  // Global visit counter (independent from the other games)
  // ===================================================================
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    const VISIT_KEY = "minesCounted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(firstOnThisDevice ? "/api/mines/visit" : "/api/mines/visits", {
        method: firstOnThisDevice ? "POST" : "GET",
        cache: "no-store",
      });
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
      const res = await fetch("/api/mines/visits", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      showVisits(Number(data.visits));
    } catch (err) {
      /* keep whatever is shown */
    }
  }

  // ---- Boot --------------------------------------------------------------
  newGame();
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000);
  initVisits();
  setInterval(refreshVisits, 30000);
})();
