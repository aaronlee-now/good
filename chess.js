/* Chess vs a bot — Fun Games.
   Rules (legal moves, check, checkmate, stalemate, castling, en passant,
   promotion) come from the chess.js library, loaded from a CDN in chess.html.
   The bot (Easy / Medium / Hard) is our own. Player is White, bot is Black. */

(() => {
  "use strict";

  // ---- Guard: did the chess.js CDN load? ---------------------------------
  // Most builds expose window.Chess as the constructor; some UMD builds wrap it
  // as window.Chess.Chess. Normalize to a single constructor, or bail out.
  const Chess =
    typeof window.Chess === "function"
      ? window.Chess
      : window.Chess && typeof window.Chess.Chess === "function"
      ? window.Chess.Chess
      : null;

  // If chess.js didn't load, show a friendly message and stop — never crash.
  if (!Chess) {
    const err = document.getElementById("load-error");
    const status = document.getElementById("status");
    if (err) err.hidden = false;
    if (status) status.textContent = "Chess library failed to load.";
    return;
  }

  // chess.js renamed several methods between 0.x and 1.0. These wrappers try the
  // new name first, then the old one, so we work with either CDN build.
  const isGameOver = (g) => (g.isGameOver ? g.isGameOver() : g.game_over());
  const isCheckmate = (g) => (g.isCheckmate ? g.isCheckmate() : g.in_checkmate());
  const isStalemate = (g) => (g.isStalemate ? g.isStalemate() : g.in_stalemate());
  const isDraw = (g) => (g.isDraw ? g.isDraw() : g.in_draw());
  const isCheck = (g) => (g.isCheck ? g.isCheck() : g.in_check());

  // ---- DOM ---------------------------------------------------------------
  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const moveCountEl = document.getElementById("move-count");
  const difficultyEl = document.getElementById("difficulty");
  const newGameBtn = document.getElementById("new-game-btn");
  const thinkingEl = document.getElementById("thinking");

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
  const visitsCountEl = document.getElementById("visits-count");

  // ---- Game state --------------------------------------------------------
  let game = new Chess();
  let selected = null;          // currently picked square, e.g. "e2", or null
  let legalTargets = new Map(); // target square -> isCapture (for highlights)
  let lastMove = null;          // { from, to } for highlighting the last move
  let playerMoveCount = 0;      // how many moves WHITE (the player) has made
  let thinking = false;         // is the bot computing?
  let promoOpen = false;        // is the promotion chooser showing?
  let gameResult = null;        // null | "player_win" | "bot_win" | "draw"

  // Captured at the moment of a win so a later difficulty change can't alter it.
  let winMoves = 0;
  let winDifficulty = "easy";

  // Unicode chess glyphs (solid set); color comes from a CSS class.
  const GLYPH = { p: "\u265F", n: "\u265E", b: "\u265D", r: "\u265C", q: "\u265B", k: "\u265A" };
  const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

  // ---- Rendering ---------------------------------------------------------
  function squareName(r, c) {
    // board() row 0 = rank 8 (top), col 0 = file a.
    return FILES[c] + (8 - r);
  }

  function kingSquareOf(color) {
    const b = game.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = b[r][c];
        if (cell && cell.type === "k" && cell.color === color) return squareName(r, c);
      }
    }
    return null;
  }

  function render() {
    const b = game.board();
    const checkSq = isCheck(game) ? kingSquareOf(game.turn()) : null;
    boardEl.innerHTML = "";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = squareName(r, c);
        const cell = b[r][c];
        const div = document.createElement("div");
        div.className = "square " + ((r + c) % 2 === 0 ? "light" : "dark");
        div.dataset.square = sq;

        if (selected === sq) div.classList.add("selected");
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) {
          div.classList.add("last-move");
        }
        if (checkSq === sq) div.classList.add("in-check");
        if (legalTargets.has(sq)) {
          div.classList.add(legalTargets.get(sq) ? "move-capture" : "move-dot");
        }

        if (cell) {
          const span = document.createElement("span");
          span.className = "piece " + cell.color;
          span.textContent = GLYPH[cell.type];
          div.appendChild(span);
        }
        boardEl.appendChild(div);
      }
    }
  }

  function refreshStatus() {
    statusEl.className = "status";
    if (gameResult === "player_win") {
      statusEl.textContent = "Checkmate — you win! 🏆";
      statusEl.classList.add("win");
      return;
    }
    if (gameResult === "bot_win") {
      statusEl.textContent = "Checkmate — the bot wins. 🤖";
      statusEl.classList.add("over");
      return;
    }
    if (gameResult === "draw") {
      statusEl.textContent = drawReason();
      statusEl.classList.add("over");
      return;
    }
    if (thinking) {
      statusEl.textContent = "Bot is thinking…";
      return;
    }
    if (isCheck(game)) {
      statusEl.textContent = game.turn() === "w" ? "You are in check!" : "Bot is in check!";
      statusEl.classList.add("check");
      return;
    }
    statusEl.textContent = game.turn() === "w" ? "Your move (White)" : "Bot to move (Black)";
  }

  function drawReason() {
    if (isStalemate(game)) return "Draw — stalemate.";
    return "Draw.";
  }

  // ---- Player interaction ------------------------------------------------
  function selectSquare(sq) {
    selected = sq;
    legalTargets = new Map();
    const moves = game.moves({ square: sq, verbose: true });
    moves.forEach((m) => {
      // A capture is a normal capture (m.captured) or en passant (flag "e").
      const isCap = !!m.captured || (m.flags && m.flags.indexOf("e") !== -1);
      legalTargets.set(m.to, legalTargets.get(m.to) || isCap);
    });
    render();
  }

  function clearSelection() {
    selected = null;
    legalTargets = new Map();
  }

  function interactionLocked() {
    return thinking || promoOpen || gameResult !== null || game.turn() !== "w";
  }

  boardEl.addEventListener("click", (e) => {
    if (interactionLocked()) return;
    const cell = e.target.closest(".square");
    if (!cell) return;
    const sq = cell.dataset.square;
    const piece = game.get(sq);

    if (selected) {
      if (legalTargets.has(sq)) {
        doPlayerMove(selected, sq);
        return;
      }
      if (piece && piece.color === "w") {
        selectSquare(sq); // switch to a different one of your pieces
      } else {
        clearSelection();
        render();
      }
      return;
    }
    if (piece && piece.color === "w") selectSquare(sq);
  });

  function doPlayerMove(from, to) {
    const moves = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!moves.length) return;
    const needsPromo = moves.some((m) => m.promotion);
    if (needsPromo) {
      choosePromotion((piece) => applyPlayerMove({ from, to, promotion: piece }));
    } else {
      applyPlayerMove({ from, to });
    }
  }

  function applyPlayerMove(mv) {
    let res = null;
    try {
      res = game.move(mv);
    } catch (err) {
      res = null;
    }
    if (!res) return;
    playerMoveCount++;
    moveCountEl.textContent = String(playerMoveCount);
    lastMove = { from: res.from, to: res.to };
    clearSelection();
    render();
    if (checkPlayerEnded()) return;
    scheduleBotMove();
  }

  // Small promotion chooser (defaults to Queen). Shows 4 buttons over the board.
  function choosePromotion(cb) {
    promoOpen = true;
    const wrap = document.createElement("div");
    wrap.className = "overlay";
    wrap.style.zIndex = "5";
    const card = document.createElement("div");
    card.className = "overlay-card";
    const h = document.createElement("h2");
    h.textContent = "Promote to…";
    card.appendChild(h);
    const row = document.createElement("div");
    row.className = "submit-row";
    [["q", "Queen ♛"], ["r", "Rook ♜"], ["b", "Bishop ♝"], ["n", "Knight ♞"]].forEach(
      ([type, label]) => {
        const btn = document.createElement("button");
        btn.className = "submit-btn";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          promoOpen = false;
          wrap.remove();
          cb(type);
        });
        row.appendChild(btn);
      }
    );
    card.appendChild(row);
    wrap.appendChild(card);
    boardEl.parentElement.appendChild(wrap);
  }

  // ---- Bot ---------------------------------------------------------------
  const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const MATE = 100000;
  const INF = 1000000;
  let searchUsePST = false;

  // Piece-square tables, indexed a1=0 .. h8=63 (rank 1 first), from White's
  // point of view. Black uses the vertical mirror. Used only on Hard.
  const PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, -20, -20, 10, 10, 5,
      5, -5, -10, 0, 0, -10, -5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, 5, 10, 25, 25, 10, 5, 5,
      10, 10, 20, 30, 30, 20, 10, 10,
      50, 50, 50, 50, 50, 50, 50, 50,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
      0, 0, 0, 5, 5, 0, 0, 0,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      5, 10, 10, 10, 10, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
      20, 30, 10, 0, 0, 10, 30, 20,
      20, 20, 0, 0, 0, 0, 20, 20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
    ],
  };

  // Material (and on Hard, piece-square) score from WHITE's perspective.
  function evaluate(g) {
    let score = 0;
    const b = g.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = b[r][c];
        if (!cell) continue;
        let v = PIECE_VALUE[cell.type];
        if (searchUsePST) {
          const table = PST[cell.type];
          const rank = 8 - r; // 1..8
          const file = c;     // 0..7
          const idx = (rank - 1) * 8 + file;
          const mirror = (8 - rank) * 8 + file;
          v += cell.color === "w" ? table[idx] : table[mirror];
        }
        score += cell.color === "w" ? v : -v;
      }
    }
    return score;
  }

  function orderMoves(moves) {
    // Search captures first so alpha-beta prunes more.
    moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
  }

  // Minimax with alpha-beta. Returns a score from WHITE's perspective.
  function search(g, depth, alpha, beta, maximizing) {
    if (isGameOver(g)) {
      if (isCheckmate(g)) {
        // The side to move has been mated.
        return g.turn() === "w" ? -(MATE + depth) : MATE + depth;
      }
      return 0; // stalemate / draw
    }
    if (depth === 0) return evaluate(g);

    const moves = g.moves({ verbose: true });
    orderMoves(moves);

    if (maximizing) {
      let best = -INF;
      for (const m of moves) {
        g.move(m);
        const s = search(g, depth - 1, alpha, beta, false);
        g.undo();
        if (s > best) best = s;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = INF;
    for (const m of moves) {
      g.move(m);
      const s = search(g, depth - 1, alpha, beta, true);
      g.undo();
      if (s < best) best = s;
      if (best < beta) beta = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function easyPick(moves) {
    const caps = moves.filter((m) => m.captured);
    if (caps.length && Math.random() < 0.6) {
      return caps[(Math.random() * caps.length) | 0];
    }
    return moves[(Math.random() * moves.length) | 0];
  }

  // Pick Black's move for the given difficulty. Black minimizes White's score.
  function chooseBotMove(diff) {
    const root = game.moves({ verbose: true });
    if (!root.length) return null;
    if (diff === "easy") return easyPick(root);

    const depth = diff === "medium" ? 2 : 3;
    searchUsePST = diff === "hard";

    const work = new Chess(game.fen());
    orderMoves(root);
    // Shuffle equally-good roots a little so the bot isn't perfectly repetitive.
    for (let i = root.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [root[i], root[j]] = [root[j], root[i]];
    }
    orderMoves(root);

    let best = null;
    let bestScore = INF;
    let alpha = -INF;
    const beta = INF;
    for (const m of root) {
      work.move(m);
      const s = search(work, depth - 1, alpha, beta, true); // White to move next
      work.undo();
      if (best === null || s < bestScore) {
        bestScore = s;
        best = m;
      }
    }
    return best;
  }

  function scheduleBotMove() {
    thinking = true;
    thinkingEl.hidden = false;
    refreshStatus();
    render();
    // setTimeout lets the browser paint the player's move + "thinking" first.
    setTimeout(() => {
      let mv = null;
      try {
        mv = chooseBotMove(difficultyEl.value);
      } catch (err) {
        mv = null;
      }
      if (mv) {
        try {
          const res = game.move(mv);
          if (res) lastMove = { from: res.from, to: res.to };
        } catch (err) {
          /* leave board as-is on the rare engine hiccup */
        }
      }
      thinking = false;
      thinkingEl.hidden = true;
      render();
      checkBotEnded();
      refreshStatus();
    }, 220);
  }

  // ---- Game-end handling -------------------------------------------------
  function checkPlayerEnded() {
    if (!isGameOver(game)) return false;
    if (isCheckmate(game) && game.turn() === "b") {
      gameResult = "player_win";
      onPlayerWin();
    } else {
      gameResult = "draw";
    }
    refreshStatus();
    return true;
  }

  function checkBotEnded() {
    if (!isGameOver(game)) return false;
    if (isCheckmate(game) && game.turn() === "w") {
      gameResult = "bot_win";
      onGameOverNonWin();
    } else {
      gameResult = "draw";
      onGameOverNonWin();
    }
    return true;
  }

  function onPlayerWin() {
    winMoves = playerMoveCount;
    winDifficulty = difficultyEl.value;
    overlayTitle.textContent = "Checkmate! 🏆";
    overlayText.textContent =
      "You beat the " + winDifficulty + " bot. Submit your win to the board!";
    overlayScore.textContent =
      "You won in " + winMoves + " move" + (winMoves === 1 ? "" : "s") + ".";

    // Reset the submission UI.
    scoreSubmitted = false;
    submitStatus.hidden = true;
    submitStatus.className = "submit-status";
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit win";
    submitRow.hidden = false;
    replaceConfirm.hidden = true;
    nameInput.value = localStorage.getItem("zooSnakeName") || "";

    overlay.classList.remove("hidden");
  }

  // Bot win or a draw: a quick celebratory-free overlay with no score submit.
  function onGameOverNonWin() {
    overlayTitle.textContent =
      gameResult === "bot_win" ? "The bot wins 🤖" : "It's a draw 🤝";
    overlayText.textContent =
      gameResult === "bot_win"
        ? "The bot checkmated you this time. Want a rematch?"
        : "No checkmate this game. Try again for a win!";
    overlayScore.textContent = "";
    submitRow.hidden = true;
    replaceConfirm.hidden = true;
    overlay.classList.remove("hidden");
  }

  // ---- New game ----------------------------------------------------------
  function newGame() {
    game = new Chess();
    selected = null;
    legalTargets = new Map();
    lastMove = null;
    playerMoveCount = 0;
    thinking = false;
    promoOpen = false;
    gameResult = null;
    moveCountEl.textContent = "0";
    overlay.classList.add("hidden");
    submitStatus.hidden = true;
    replaceConfirm.hidden = true;
    render();
    refreshStatus();
  }

  newGameBtn.addEventListener("click", newGame);
  overlayNewBtn.addEventListener("click", newGame);

  // ===================================================================
  // Global leaderboard — wins in the FEWEST moves
  // ===================================================================
  let scoreSubmitted = false;
  let highlight = null;     // { name, moves } of the row we just submitted
  let currentScores = [];   // latest collapsed board (best per name)

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // Positive if `a` ranks AHEAD of `b`: fewer moves wins; tie → earlier ts.
  function rankCompare(a, b) {
    const dm = (Number(b.moves) || 0) - (Number(a.moves) || 0);
    if (dm !== 0) return dm;
    return (Number(b.ts) || 0) - (Number(a.ts) || 0);
  }

  // Collapse an append-only board to ONE entry per normalized name, keeping each
  // player's BEST (fewest-move) win. Result is sorted best-first.
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
      lbNote.textContent = "No wins yet — be the first! 🏆";
      lbNote.hidden = false;
      return;
    }
    lbNote.hidden = true;
    collapsed.slice(0, 20).forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      if (highlight && s.name === highlight.name && s.moves === highlight.moves) {
        li.classList.add("you");
      }
      li.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(s.name)}</span>` +
        `<span class="lb-moves">${Number(s.moves) || 0}</span>` +
        `<span class="lb-diff">${escapeHtml(s.difficulty || "")}</span>`;
      lbList.appendChild(li);
    });
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/chess/leaderboard", { cache: "no-store" });
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

  // "Better" = fewer moves. A tie does NOT beat the old score.
  function runIsBetter(run, prev) {
    return (Number(run.moves) || 0) < (Number(prev.moves) || 0);
  }

  function showNameTaken() {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit win";
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

    const better = runIsBetter({ moves: winMoves }, prevEntry);
    replaceWelcome.textContent = `Welcome back, ${name}!`;
    replacePrev.textContent =
      `Your best: ${Number(prevEntry.moves) || 0} moves (${prevEntry.difficulty || "?"})`;
    replaceThis.textContent = `This win: ${winMoves} moves (${winDifficulty})`;

    if (better) {
      replaceVerdict.textContent = "New record — fewer moves! 🎉";
      replaceVerdict.className = "replace-verdict win";
      replaceYes.textContent = "Replace my score";
    } else {
      replaceVerdict.textContent = "This win didn't beat your best.";
      replaceVerdict.className = "replace-verdict lose";
      replaceYes.textContent = "Replace anyway (more moves)";
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

    const payload = { name, moves: winMoves, difficulty: winDifficulty, replace };
    try {
      const res = await fetch("/api/chess/score", {
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
      highlight = { name, moves: winMoves };
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
    submitBtn.textContent = "Submit win";
    submitStatus.textContent = "Kept your old score.";
    submitStatus.className = "submit-status ok";
    submitStatus.hidden = false;
    await fetchLeaderboard();
  });

  // ===================================================================
  // Global visit counter (independent from Snake)
  // ===================================================================
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    const VISIT_KEY = "chessCounted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(firstOnThisDevice ? "/api/chess/visit" : "/api/chess/visits", {
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
      const res = await fetch("/api/chess/visits", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      showVisits(Number(data.visits));
    } catch (err) {
      /* keep whatever is shown */
    }
  }

  // ---- Boot --------------------------------------------------------------
  render();
  refreshStatus();
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000);
  initVisits();
  setInterval(refreshVisits, 30000);
})();
