/* Zoo Snake — a classic Snake game with a zoo theme and a chasing zookeeper.
   Pure vanilla JS + HTML5 canvas. No dependencies, works as static files. */

(() => {
  "use strict";

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const LOGICAL = 600;          // logical drawing space (0..600), independent of screen size
  const GRID = 24;              // cells per side
  const CELL = LOGICAL / GRID;  // pixel size of one cell

  // Make the canvas crisp on high-DPI screens while we keep drawing in a fixed
  // 0..LOGICAL coordinate space.
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || LOGICAL;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const s = (size * dpr) / LOGICAL;
    ctx.setTransform(s, 0, 0, s, 0, 0);
  }
  window.addEventListener("resize", fitCanvas);

  // ---- DOM ----------------------------------------------------------------
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayScore = document.getElementById("overlay-score");
  const startBtn = document.getElementById("start-btn");
  const resumeBtn = document.getElementById("resume-btn");

  // Leaderboard + score-submission DOM.
  const submitRow = document.getElementById("submit-row");
  const nameInput = document.getElementById("name-input");
  const submitBtn = document.getElementById("submit-btn");
  const submitStatus = document.getElementById("submit-status");
  const lbList = document.getElementById("lb-list");
  const lbNote = document.getElementById("lb-note");

  // Global visit counter display.
  const visitsCountEl = document.getElementById("visits-count");

  // Replace-your-own-score confirmation DOM (shown to a returning player whose
  // remembered account name is already on the board).
  const replaceConfirm = document.getElementById("replace-confirm");
  const replaceWelcome = document.getElementById("replace-welcome");
  const replacePrev = document.getElementById("replace-prev");
  const replaceThis = document.getElementById("replace-this");
  const replaceVerdict = document.getElementById("replace-verdict");
  const replaceYes = document.getElementById("replace-yes");
  const replaceNo = document.getElementById("replace-no");

  // ---- Game state ---------------------------------------------------------
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  let snake, prevSnake, dir, nextDir, grew;
  let food, foodPrev;
  let man, manPrev;
  let score, best;
  let running = false, paused = false, gameOver = false;

  // timing (ms)
  let tickInterval;            // snake step interval (shrinks as you grow)
  let lastTick;                // timestamp of last snake step
  let manInterval, lastManTick; // zookeeper steps on its own, slower clock

  // Survival timer. We measure wall-clock time from start to game over, but
  // subtract any time spent paused so pausing can't pad your score.
  let gameStartTime = 0;       // performance.now() when the round began
  let pausedAccum = 0;         // total ms spent paused this round
  let pauseStarted = 0;        // performance.now() when the current pause began
  let lastSurvivalMs = 0;      // survival time of the round that just ended
  let scoreSubmitted = false;  // guard so we don't submit the same round twice

  best = Number(localStorage.getItem("zooSnakeBest") || 0);
  bestEl.textContent = best;

  // ---- Save & resume (per-device, localStorage) ---------------------------
  // We snapshot an IN-PROGRESS round so the player can close the tab / restart
  // the browser on THIS device and pick up exactly where they left off.
  const SAVE_KEY = "zooSnakeSave";
  const SAVE_VERSION = 1;
  let lastSaveAt = 0;          // throttle: performance.now() of last write
  let pendingResume = null;    // a valid loaded save waiting for the player to Resume

  // Static zoo scenery (enclosures with an animal + decorative trees).
  // These are visual only; they never block the snake. Walls are the border.
  const ENCLOSURES = [
    { x: 3, y: 3, w: 5, h: 4, animal: "🦁" },
    { x: 16, y: 3, w: 5, h: 4, animal: "🐘" },
    { x: 3, y: 17, w: 5, h: 4, animal: "🦒" },
    { x: 16, y: 17, w: 5, h: 4, animal: "🦓" },
  ];
  const TREES = [
    { x: 11.5, y: 1, e: "🌳" }, { x: 12.5, y: 22.5, e: "🌳" },
    { x: 1, y: 11.5, e: "🌴" }, { x: 22.5, y: 12, e: "🌴" },
  ];

  // ---- Helpers ------------------------------------------------------------
  function lerp(a, b, t) { return a + (b - a) * t; }

  function cellsEqual(a, b) { return a.x === b.x && a.y === b.y; }

  function onSnake(cell, includeHead = true) {
    for (let i = includeHead ? 0 : 1; i < snake.length; i++) {
      if (cellsEqual(snake[i], cell)) return true;
    }
    return false;
  }

  function spawnFood() {
    let c;
    do {
      c = { x: (Math.random() * GRID) | 0, y: (Math.random() * GRID) | 0 };
    } while (onSnake(c) || (man && cellsEqual(c, man)));
    // The new apple appears at its cell — it must NOT animate from the old
    // (eaten) cell. drawFood lerps foodPrev -> food by tSnake, and tSnake
    // resets 0->1 every tick, so any gap between foodPrev and food would make
    // the apple slide back and forth ("side to side") forever. Keep them equal.
    food = c;
    foodPrev = { ...c };
  }

  function reset() {
    // Snake starts as a 1-by-4 snake (4 cells long), heading right.
    const cy = (GRID / 2) | 0;
    snake = [
      { x: 8, y: cy },
      { x: 7, y: cy },
      { x: 6, y: cy },
      { x: 5, y: cy },
    ];
    prevSnake = snake.map((c) => ({ ...c }));
    dir = DIRS.right;
    nextDir = DIRS.right;
    grew = false;

    // Zookeeper starts in the far corner so there's a head start.
    man = { x: GRID - 2, y: GRID - 2 };
    manPrev = { ...man };

    score = 0;
    scoreEl.textContent = "0";
    tickInterval = 135;
    manInterval = 230;
    food = null;
    spawnFood();

    gameOver = false;
    paused = false;
  }

  // ---- Logic steps --------------------------------------------------------
  function stepSnake() {
    // Commit the queued direction (already validated to not be a 180 reversal).
    dir = nextDir;
    prevSnake = snake.map((c) => ({ ...c }));

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision (we use walls, not wrap, for tension).
    if (head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID) {
      return endGame();
    }
    // Self collision (ignore the current tail tip, which will move away —
    // unless we're about to grow).
    const willEat = food && head.x === food.x && head.y === food.y;
    for (let i = 0; i < snake.length - (willEat ? 0 : 1); i++) {
      if (cellsEqual(snake[i], head)) return endGame();
    }

    snake.unshift(head);
    grew = willEat;
    if (willEat) {
      score++;
      scoreEl.textContent = score;
      // Speed up gently as the snake grows; keep a playable floor.
      tickInterval = Math.max(80, 135 - score * 2);
      manInterval = Math.max(150, 230 - score * 2);
      spawnFood();
    } else {
      snake.pop();
    }

    // Caught by the zookeeper?
    if (cellsEqual(head, man)) endGame();
  }

  function stepMan() {
    manPrev = { ...man };
    const head = snake[0];
    const dx = head.x - man.x;
    const dy = head.y - man.y;

    // Greedy pursuit: close the larger gap first, with a little wobble so the
    // chase feels less robotic.
    let step = { x: 0, y: 0 };
    const preferX = Math.abs(dx) > Math.abs(dy);
    const wobble = Math.random() < 0.18;
    if ((preferX && !wobble) || (!preferX && wobble)) {
      step.x = Math.sign(dx) || (Math.random() < 0.5 ? 1 : -1);
    } else {
      step.y = Math.sign(dy) || (Math.random() < 0.5 ? 1 : -1);
    }

    man.x = Math.max(0, Math.min(GRID - 1, man.x + step.x));
    man.y = Math.max(0, Math.min(GRID - 1, man.y + step.y));

    if (cellsEqual(man, head)) endGame();
  }

  function endGame() {
    gameOver = true;
    running = false;

    // The round is over — nothing in-progress left to resume on this device.
    clearSave();
    pendingResume = null;
    resumeBtn.hidden = true;
    startBtn.classList.remove("secondary");

    // Lock in survival time (minus any paused time).
    lastSurvivalMs = Math.max(0, Math.round(performance.now() - gameStartTime - pausedAccum));

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("zooSnakeBest", String(best));
    }
    overlayTitle.textContent = "Caught! 🧑‍🌾";
    overlayText.textContent =
      "The zookeeper got you (or you hit a fence / yourself). Want another go?";
    overlayScore.hidden = false;
    overlayScore.textContent =
      `You collected ${score} 🍎 and survived ${formatTime(lastSurvivalMs)}`;
    startBtn.textContent = "Play Again";

    // Get ready to submit this round to the global leaderboard.
    scoreSubmitted = false;
    submitStatus.hidden = true;
    submitStatus.className = "submit-status";
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit 🍎 score";
    nameInput.value = localStorage.getItem("zooSnakeName") || "";
    submitRow.hidden = false;
    replaceConfirm.hidden = true;  // start fresh; only shown if a returning player re-submits

    overlay.classList.remove("hidden");
  }

  // ---- Drawing ------------------------------------------------------------
  function drawBackground() {
    // Grass base with a soft light gradient.
    const g = ctx.createLinearGradient(0, 0, 0, LOGICAL);
    g.addColorStop(0, "#86d05f");
    g.addColorStop(1, "#5fa83e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LOGICAL, LOGICAL);

    // Faint mowed-grass stripes for texture.
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let i = 0; i < GRID; i += 2) {
      ctx.fillRect(0, i * CELL, LOGICAL, CELL);
    }

    // A cross of dirt paths through the middle.
    ctx.fillStyle = "#c9a24a";
    roundRect(LOGICAL / 2 - CELL * 0.9, 0, CELL * 1.8, LOGICAL, 6);
    ctx.fill();
    roundRect(0, LOGICAL / 2 - CELL * 0.9, LOGICAL, CELL * 1.8, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.fillRect(LOGICAL / 2 - 2, 0, 4, LOGICAL);
    ctx.fillRect(0, LOGICAL / 2 - 2, LOGICAL, 4);

    // Enclosures with fences and a resident animal.
    for (const e of ENCLOSURES) drawEnclosure(e);

    // Scenery trees.
    ctx.font = `${CELL * 1.6}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of TREES) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillText(t.e, t.x * CELL, t.y * CELL);
      ctx.restore();
    }

    // Very subtle grid to help judge distances.
    ctx.strokeStyle = "rgba(0,0,0,0.045)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < GRID; i++) {
      ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, LOGICAL);
      ctx.moveTo(0, i * CELL); ctx.lineTo(LOGICAL, i * CELL);
    }
    ctx.stroke();
  }

  function drawEnclosure(e) {
    const x = e.x * CELL, y = e.y * CELL, w = e.w * CELL, h = e.h * CELL;
    // Darker patch of ground.
    ctx.save();
    ctx.fillStyle = "rgba(70,120,45,0.55)";
    roundRect(x, y, w, h, 10);
    ctx.fill();

    // Wooden fence rail + posts.
    ctx.strokeStyle = "#8a5a2b";
    ctx.lineWidth = 4;
    roundRect(x, y, w, h, 10);
    ctx.stroke();
    ctx.fillStyle = "#a06a34";
    const posts = 6;
    for (let i = 0; i <= posts; i++) {
      const px = x + (w * i) / posts;
      ctx.fillRect(px - 2, y - 3, 4, h + 6);
    }
    ctx.restore();

    // The animal.
    ctx.font = `${Math.min(w, h) * 0.6}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(e.animal, x + w / 2, y + h / 2);
  }

  function drawShadow(cx, cy, r) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.55, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFood(t) {
    const cx = lerp(foodPrev.x, food.x, t) * CELL + CELL / 2;
    const cy = lerp(foodPrev.y, food.y, t) * CELL + CELL / 2;
    const pulse = 1 + Math.sin(performance.now() / 240) * 0.06;
    const r = CELL * 0.36 * pulse;

    drawShadow(cx, cy, r);

    // Apple body with a glossy gradient.
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    g.addColorStop(0, "#ff7a7a");
    g.addColorStop(1, "#c81e1e");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Shine.
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.35, cy - r * 0.35, r * 0.18, r * 0.28, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // Stem + leaf.
    ctx.strokeStyle = "#6b3f1d";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.9);
    ctx.lineTo(cx + 1, cy - r * 1.3);
    ctx.stroke();
    ctx.fillStyle = "#3fae3f";
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.45, cy - r * 1.15, r * 0.32, r * 0.16, -0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Interpolated pixel center of snake segment i.
  function segCenter(i, t) {
    const cur = snake[i];
    const prev = i < prevSnake.length ? prevSnake[i] : cur;
    return {
      x: lerp(prev.x, cur.x, t) * CELL + CELL / 2,
      y: lerp(prev.y, cur.y, t) * CELL + CELL / 2,
    };
  }

  function drawSnake(t) {
    const pts = snake.map((_, i) => segCenter(i, t));
    if (pts.length < 1) return;

    // Soft shadow beneath the whole body.
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = CELL * 0.85;
    strokePath(pts.map((p) => ({ x: p.x, y: p.y + 4 })));
    ctx.restore();

    // Tapered body: stroke each segment with a shrinking width + gradient color.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i], b = pts[i - 1];
      const f = i / pts.length;                 // 1 at tail, ~0 near head
      const width = CELL * (0.5 + (1 - f) * 0.42);
      // dark outline
      ctx.strokeStyle = "#1f6b22";
      ctx.lineWidth = width + 4;
      line(a, b);
      // body color, brighter toward the head
      const shade = Math.round(120 + (1 - f) * 90);
      ctx.strokeStyle = `rgb(${Math.round(shade * 0.45)}, ${shade + 40}, ${Math.round(shade * 0.4)})`;
      ctx.lineWidth = width;
      line(a, b);
    }

    // Belly highlight + scale dots.
    for (let i = pts.length - 1; i > 0; i--) {
      const p = pts[i];
      const f = i / pts.length;
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, CELL * (0.18 + (1 - f) * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }

    drawSnakeHead(pts[0], t);
  }

  function drawSnakeHead(head, t) {
    const r = CELL * 0.6;
    drawShadow(head.x, head.y, r * 0.9);

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(dir.y, dir.x));

    // Head shape (rounded, slightly elongated forward).
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#8ce05a");
    g.addColorStop(1, "#3a9b34");
    ctx.fillStyle = g;
    ctx.strokeStyle = "#1f6b22";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Nostrils.
    ctx.fillStyle = "#1f6b22";
    ctx.beginPath();
    ctx.arc(r * 0.85, -r * 0.18, 2, 0, Math.PI * 2);
    ctx.arc(r * 0.85, r * 0.18, 2, 0, Math.PI * 2);
    ctx.fill();

    // Forked tongue, flicking now and then.
    if (running && Math.sin(performance.now() / 160) > 0.3) {
      ctx.strokeStyle = "#e23b5a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(r * 1.0, 0);
      ctx.lineTo(r * 1.5, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 1.75, -r * 0.18);
      ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 1.75, r * 0.18);
      ctx.stroke();
    }

    // Eyes (whites + dark pupils), set near the front.
    for (const sy of [-1, 1]) {
      const ex = r * 0.25, ey = sy * r * 0.42;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#10250f";
      ctx.beginPath();
      ctx.arc(ex + r * 0.08, ey, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(ex + r * 0.02, ey - r * 0.07, r * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMan(t) {
    const cx = lerp(manPrev.x, man.x, t) * CELL + CELL / 2;
    const cy = lerp(manPrev.y, man.y, t) * CELL + CELL / 2;
    const r = CELL * 0.5;
    const bob = Math.sin(performance.now() / 90) * 2; // little run animation

    drawShadow(cx, cy, r);

    ctx.save();
    ctx.translate(cx, cy + bob);

    // Legs.
    ctx.strokeStyle = "#3a3a4a";
    ctx.lineWidth = r * 0.28;
    ctx.lineCap = "round";
    const legSwing = Math.sin(performance.now() / 90) * r * 0.3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, r * 0.2); ctx.lineTo(-r * 0.18 + legSwing, r * 0.7);
    ctx.moveTo(r * 0.18, r * 0.2); ctx.lineTo(r * 0.18 - legSwing, r * 0.7);
    ctx.stroke();

    // Body / khaki zookeeper shirt.
    const bg = ctx.createLinearGradient(0, -r * 0.4, 0, r * 0.3);
    bg.addColorStop(0, "#cdb37a");
    bg.addColorStop(1, "#a88b52");
    ctx.fillStyle = bg;
    roundRect(-r * 0.34, -r * 0.45, r * 0.68, r * 0.75, r * 0.18);
    ctx.fill();

    // Arms (reaching forward toward the snake side a bit).
    ctx.strokeStyle = "#cdb37a";
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.25); ctx.lineTo(-r * 0.6, -r * 0.05 + legSwing);
    ctx.moveTo(r * 0.3, -r * 0.25); ctx.lineTo(r * 0.6, -r * 0.05 - legSwing);
    ctx.stroke();

    // Head.
    ctx.fillStyle = "#f1c089";
    ctx.beginPath();
    ctx.arc(0, -r * 0.62, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // Safari hat.
    ctx.fillStyle = "#6e4a23";
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.78, r * 0.5, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.9, r * 0.26, r * 0.2, 0, Math.PI, 0);
    ctx.fill();

    // Eyes — focused on the chase.
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(-r * 0.1, -r * 0.6, r * 0.05, 0, Math.PI * 2);
    ctx.arc(r * 0.1, -r * 0.6, r * 0.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ---- Canvas path utils --------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  function strokePath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // ---- Main loop ----------------------------------------------------------
  function frame(now) {
    if (running && !paused) {
      // Step the snake on its clock.
      while (now - lastTick >= tickInterval) {
        lastTick += tickInterval;
        stepSnake();
        if (!running) break;
      }
      // Step the zookeeper on its slower clock.
      while (running && now - lastManTick >= manInterval) {
        lastManTick += manInterval;
        stepMan();
      }

      // Persist progress at most ~once per second (not every frame).
      if (running && now - lastSaveAt >= 1000) saveGame();
    }

    // Interpolation factors for smooth motion.
    const tSnake = running && !paused
      ? Math.min(1, (now - lastTick) / tickInterval) : 1;
    const tMan = running && !paused
      ? Math.min(1, (now - lastManTick) / manInterval) : 1;

    drawBackground();
    if (food) drawFood(tSnake);
    drawSnake(tSnake);
    drawMan(tMan);

    if (paused) drawPausedBanner();

    requestAnimationFrame(frame);
  }

  function drawPausedBanner() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, LOGICAL / 2 - 40, LOGICAL, 80);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 34px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Paused — press P", LOGICAL / 2, LOGICAL / 2);
    ctx.restore();
  }

  // ---- Controls -----------------------------------------------------------
  function setDir(name) {
    const d = DIRS[name];
    if (!d) return;
    // Block 180° reversals against the *committed* direction.
    if (d.x === -dir.x && d.y === -dir.y) return;
    nextDir = d;
  }

  const KEYMAP = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    w: "up", s: "down", a: "left", d: "right",
    W: "up", S: "down", A: "left", D: "right",
  };

  window.addEventListener("keydown", (e) => {
    // When the player is typing their name, let the input have every key.
    if (document.activeElement === nameInput) return;
    if (KEYMAP[e.key]) {
      e.preventDefault();
      if (running && !paused) setDir(KEYMAP[e.key]);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      // If a button (Submit / Start) is focused, let it handle the key itself
      // instead of hijacking it to start a new game.
      if (document.activeElement && document.activeElement.tagName === "BUTTON") {
        return;
      }
      e.preventDefault();
      if (!running) startGame();
      return;
    }
    if ((e.key === "p" || e.key === "P") && running) {
      togglePause();
    }
  });

  // ---- Touch / mobile support --------------------------------------------
  // Detect touch capability automatically (never ask the player). When found,
  // tag <body> so the CSS reveals the on-screen D-pad; desktop stays untouched.
  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (isTouch) document.body.classList.add("touch");

  // On-screen d-pad (touch + mouse). Both routes call the SAME setDir() the
  // keyboard uses, so the no-180°-reversal rule is respected everywhere.
  const dpad = document.getElementById("dpad");
  // touchstart with preventDefault removes the 300ms tap delay and the ghost
  // click, and stops the tap from selecting text or scrolling.
  dpad.addEventListener("touchstart", (e) => {
    const btn = e.target.closest(".dpad-btn");
    if (!btn) return;
    e.preventDefault();
    if (running && !paused) setDir(btn.dataset.dir);
  }, { passive: false });
  // Click keeps the pad usable with a mouse / keyboard activation.
  dpad.addEventListener("click", (e) => {
    const btn = e.target.closest(".dpad-btn");
    if (btn && running && !paused) setDir(btn.dataset.dir);
  });

  // Swipe controls on the canvas. A swipe up/down/left/right routes through the
  // same setDir() as the keyboard and D-pad.
  const SWIPE_MIN = 24; // px before a drag counts as a swipe
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  // Block scrolling ONLY while a swipe is in progress on the board — the rest
  // of the page can still scroll normally.
  canvas.addEventListener("touchmove", (e) => {
    if (touchStart) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const tx = e.changedTouches[0].clientX - touchStart.x;
    const ty = e.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(tx) > SWIPE_MIN || Math.abs(ty) > SWIPE_MIN) {
      if (Math.abs(tx) > Math.abs(ty)) setDir(tx > 0 ? "right" : "left");
      else setDir(ty > 0 ? "down" : "up");
    }
    touchStart = null;
  }, { passive: true });

  startBtn.addEventListener("click", startGame);
  resumeBtn.addEventListener("click", () => {
    if (pendingResume) resumeGame(pendingResume);
  });

  // Capture recent progress even on an abrupt close: when the tab is hidden or
  // the page is about to unload, write the latest state immediately.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame();
  });
  window.addEventListener("beforeunload", saveGame);

  function togglePause() {
    paused = !paused;
    const now = performance.now();
    if (paused) {
      pauseStarted = now;          // start counting paused time
    } else {
      pausedAccum += now - pauseStarted; // add this pause to the total
      // Avoid a giant catch-up jump after unpausing.
      lastTick = now;
      lastManTick = now;
    }
    // Persist the new paused flag so a close mid-pause comes back paused.
    saveGame();
  }

  function startGame() {
    // "New game" discards any saved run and starts completely fresh.
    clearSave();
    pendingResume = null;
    resumeBtn.hidden = true;
    startBtn.classList.remove("secondary");
    reset();
    overlay.classList.add("hidden");
    overlayScore.hidden = true;
    submitRow.hidden = true;
    running = true;
    const now = performance.now();
    lastTick = now;
    lastManTick = now;
    gameStartTime = now;
    pausedAccum = 0;
  }

  // ---- Global leaderboard -------------------------------------------------
  // Format milliseconds as m:ss (e.g. 75200 -> "1:15").
  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  // Escape text before putting it in the DOM (defense in depth — the server
  // also sanitizes names).
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Highlight the row that matches the score we just submitted.
  let highlight = null; // { name, apples, timeMs } or null

  // Latest board the server sent us, sorted best-first. Used to find whether
  // this player ("account") already has an entry before they submit.
  let currentScores = [];

  // Compare two entries with the SAME ranking used everywhere on the board:
  // more apples wins; tie → longer timeMs wins. Returns positive if `a` ranks
  // ahead of `b`, negative if behind, 0 if exactly tied on both.
  function rankCompare(a, b) {
    const da = (Number(a.apples) || 0) - (Number(b.apples) || 0);
    if (da !== 0) return da;
    return (Number(a.timeMs) || 0) - (Number(b.timeMs) || 0);
  }

  // Collapse an append-only board (which can list the same player many times)
  // down to ONE entry per normalized name (trim + lowercase), keeping each
  // player's BEST run. The kept entry's ORIGINAL display name is preserved, and
  // exact ties fall back to the earliest ts. Result is sorted best-first.
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
        bestByName.set(key, s); // strictly better run
      } else if (cmp === 0 && (Number(s.ts) || 0) < (Number(prev.ts) || 0)) {
        bestByName.set(key, s); // exact tie → keep the earliest
      }
    });
    return Array.from(bestByName.values()).sort((a, b) => rankCompare(b, a));
  }

  function renderLeaderboard(scores) {
    // The live (append-only) server can hold MANY rows for the same name. Before
    // showing anything, collapse to ONE row per player (their best), so the board
    // — and currentScores, which the submit/replace logic reads — never has dupes.
    const collapsed = collapseScores(Array.isArray(scores) ? scores : []);
    currentScores = collapsed;
    lbList.innerHTML = "";
    if (!collapsed.length) {
      lbNote.textContent = "No scores yet — be the first! 🍎";
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
        s.apples === highlight.apples &&
        s.timeMs === highlight.timeMs
      ) {
        li.classList.add("you");
      }
      li.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(s.name)}</span>` +
        `<span class="lb-apples">${Number(s.apples) || 0}</span>` +
        `<span class="lb-time">${formatTime(Number(s.timeMs) || 0)}</span>`;
      lbList.appendChild(li);
    });
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      renderLeaderboard(Array.isArray(data.scores) ? data.scores : []);
    } catch (err) {
      lbNote.textContent = "Couldn't load leaderboard.";
      lbNote.hidden = false;
    }
  }

  // Fold a name to the same identity key the server uses (trim + lowercase),
  // so "Bob", "bob" and " BOB " all count as the SAME name.
  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // Is this name already on the board? Names must be UNIQUE, so any match means
  // the player has to pick a different one. NOTE: the frontend only sees the
  // top-20 board, so this catches duplicates among the visible leaders; the
  // server enforces uniqueness across all stored scores authoritatively.
  function nameIsTaken(name) {
    const norm = normalizeName(name);
    return currentScores.some((s) => normalizeName(s.name) === norm);
  }

  // Show the friendly "pick another name" message and let the player retry.
  function showNameTaken() {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit 🍎 score";
    submitStatus.textContent =
      "🚫 That name is already taken — please choose a different one.";
    submitStatus.className = "submit-status taken";
    submitStatus.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  // Find the player's best existing entry for a given name (normalized match).
  // The board is sorted best-first, so the FIRST match is their best score.
  function bestEntryForName(name) {
    const norm = normalizeName(name);
    return currentScores.find((s) => normalizeName(s.name) === norm) || null;
  }

  // Is `run` a better result than `prev`, using the SAME ranking as the board:
  // more apples wins; equal apples → longer survival time wins. Equal on both
  // counts as NOT higher (a tie doesn't beat your old score).
  function runIsHigher(run, prev) {
    const a = Number(run.apples) || 0;
    const b = Number(prev.apples) || 0;
    if (a !== b) return a > b;
    return (Number(run.timeMs) || 0) > (Number(prev.timeMs) || 0);
  }

  // Show the "it's your account — replace your score?" confirmation for a
  // returning player. `prevEntry` is their best entry already on the board.
  function showReplaceConfirm(name, prevEntry) {
    submitRow.hidden = true;
    submitStatus.hidden = true;

    const run = { apples: score, timeMs: lastSurvivalMs };
    const higher = runIsHigher(run, prevEntry);

    // textContent everywhere so a player-chosen name can never inject markup.
    replaceWelcome.textContent = `Welcome back, ${name}!`;
    replacePrev.textContent =
      `Your best: ${Number(prevEntry.apples) || 0} 🍎 · ${formatTime(Number(prevEntry.timeMs) || 0)}`;
    replaceThis.textContent =
      `This run: ${score} 🍎 · ${formatTime(lastSurvivalMs)}`;

    if (higher) {
      replaceVerdict.textContent = "New high score! 🎉";
      replaceVerdict.className = "replace-verdict win";
      replaceYes.textContent = "Replace my score";
    } else {
      replaceVerdict.textContent = "This run didn't beat your best.";
      replaceVerdict.className = "replace-verdict lose";
      // Still allow replacing, but make it clear it's a downgrade.
      replaceYes.textContent = "Replace anyway (lower)";
    }

    replaceConfirm.hidden = false;
    replaceYes.focus();
  }

  // Validate the entered name, then decide: new entry, your-account replace, or
  // blocked (someone else's name).
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

    // Refresh the board so the ownership check uses the latest names. If the
    // fetch fails we fall back to the cached board rather than blocking play.
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    submitStatus.hidden = true;
    await fetchLeaderboard();

    if (!nameIsTaken(name)) {
      // Brand-new name → submit as a new entry and remember it as this device.
      localStorage.setItem("zooSnakeName", name);
      submitScore(name);
      return;
    }

    // The name IS on the board. Is it THIS device's remembered account?
    const ownName = normalizeName(localStorage.getItem("zooSnakeName"));
    if (ownName && normalizeName(name) === ownName) {
      // Their own account → offer to replace instead of blocking.
      const prevEntry = bestEntryForName(name);
      if (prevEntry) {
        showReplaceConfirm(name, prevEntry);
        return;
      }
      // No matching entry found locally (shouldn't happen since nameIsTaken was
      // true) — fall back to a plain new submission.
      localStorage.setItem("zooSnakeName", name);
      submitScore(name);
      return;
    }

    // On the board but not this device's name → it's someone else's. Block.
    showNameTaken();
  }

  async function submitScore(name, replace = false) {
    submitRow.hidden = false;
    replaceConfirm.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    submitStatus.hidden = true;

    const payload = { name, apples: score, timeMs: lastSurvivalMs, replace };
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // A 409 can only come back from the "someone else's name" path (replace is
      // false there). Treat it like a "name taken" so the player can pick another.
      if (res.status === 409) {
        showNameTaken();
        await fetchLeaderboard();
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      scoreSubmitted = true;
      // This device now owns this name going forward.
      localStorage.setItem("zooSnakeName", name);
      highlight = { name, apples: score, timeMs: lastSurvivalMs };
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

  // Replace confirmation: "Replace my score" submits with replace=true.
  replaceYes.addEventListener("click", () => {
    if (scoreSubmitted) return;
    const name = (nameInput.value || "").trim().slice(0, 16);
    if (!name) return;
    submitScore(name, true);
  });

  // "Keep my old score" submits nothing — just restore the row and refresh.
  replaceNo.addEventListener("click", async () => {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit 🍎 score";
    submitStatus.textContent = "Kept your old score.";
    submitStatus.className = "submit-status ok";
    submitStatus.hidden = false;
    await fetchLeaderboard();
  });

  // ---- Global visit counter -----------------------------------------------
  // Show a number with thousands separators (e.g. 1234 -> "1,234"). Anything
  // that isn't a real number shows the "—" fallback so the page never breaks.
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  // Count EXACTLY ONCE PER DEVICE, then keep the displayed number fresh.
  // Uses localStorage (persists across sessions/replays) so a device only ever
  // adds a single visit — replaying or coming back later does NOT increment.
  // A different device (or browser) with no flag counts as a new visit.
  // A failed request just shows "—" and never touches the game or leaderboard.
  async function initVisits() {
    const VISIT_KEY = "zooSnakeCounted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(firstOnThisDevice ? "/api/visit" : "/api/visits", {
        method: firstOnThisDevice ? "POST" : "GET",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      // Mark this device as counted only AFTER a successful increment, so a
      // failed first call can retry as an increment on the next load.
      if (firstOnThisDevice) localStorage.setItem(VISIT_KEY, "1");
      showVisits(Number(data.visits));
    } catch (err) {
      // Endpoint missing/unreachable (e.g. old server) — graceful fallback.
      showVisits(NaN);
    }
  }

  // Refresh just the displayed number (never increments) so the count stays
  // current as other people visit.
  async function refreshVisits() {
    try {
      const res = await fetch("/api/visits", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      showVisits(Number(data.visits));
    } catch (err) {
      // Leave whatever is currently shown; don't clobber a good number.
    }
  }

  // ---- Save & resume helpers ----------------------------------------------
  // Turn a direction object (a reference into DIRS) into its name for storage.
  function dirToName(d) {
    for (const k in DIRS) {
      if (DIRS[k].x === d.x && DIRS[k].y === d.y) return k;
    }
    return "right";
  }

  // Is this a plain {x,y} cell sitting inside the grid?
  function validCell(c) {
    return c && Number.isInteger(c.x) && Number.isInteger(c.y) &&
      c.x >= 0 && c.x < GRID && c.y >= 0 && c.y < GRID;
  }

  // Write the current in-progress round to localStorage. No-op (and clears any
  // stale save) once the game is over. Wrapped so storage errors never crash.
  function saveGame() {
    if (!running && !paused) return;
    if (gameOver) return;
    try {
      const data = {
        version: SAVE_VERSION,
        savedAt: Date.now(),
        snake: snake.map((c) => ({ x: c.x, y: c.y })),
        prevSnake: prevSnake.map((c) => ({ x: c.x, y: c.y })),
        dir: dirToName(dir),
        nextDir: dirToName(nextDir),
        grew,
        food: food ? { x: food.x, y: food.y } : null,
        foodPrev: foodPrev ? { x: foodPrev.x, y: foodPrev.y } : null,
        man: { x: man.x, y: man.y },
        manPrev: { x: manPrev.x, y: manPrev.y },
        score,
        tickInterval,
        manInterval,
        // Survival time accumulated so far (paused time already removed). On
        // resume we keep counting from this so the leaderboard timer is fair.
        elapsedMs: Math.max(0, Math.round(performance.now() - gameStartTime - pausedAccum)),
        paused,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      lastSaveAt = performance.now();
    } catch (err) {
      // Storage full / disabled / private mode — just skip saving.
    }
  }

  // Read + validate a saved round. Returns the parsed object or null if the
  // save is missing, corrupt, the wrong version, or otherwise unusable.
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.version !== SAVE_VERSION) return null;
      if (!Array.isArray(s.snake) || s.snake.length < 1) return null;
      if (!s.snake.every(validCell)) return null;
      if (!validCell(s.food)) return null;
      if (!validCell(s.man)) return null;
      if (!DIRS[s.dir] || !DIRS[s.nextDir]) return null;
      if (typeof s.score !== "number" || s.score < 0) return null;
      return s;
    } catch (err) {
      return null;
    }
  }

  // Forget the saved round (after game over, or when the player starts fresh).
  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (err) {
      // Ignore — nothing we can do if storage is unavailable.
    }
  }

  // Rebuild all game state from a validated save object. Used both to show the
  // frozen board preview behind the overlay and to continue the run.
  function applySave(s) {
    snake = s.snake.map((c) => ({ x: c.x, y: c.y }));
    prevSnake = Array.isArray(s.prevSnake) && s.prevSnake.length === snake.length
      ? s.prevSnake.map((c) => ({ x: c.x, y: c.y }))
      : snake.map((c) => ({ ...c }));
    dir = DIRS[s.dir];
    nextDir = DIRS[s.nextDir];
    grew = !!s.grew;

    food = { x: s.food.x, y: s.food.y };
    foodPrev = validCell(s.foodPrev) ? { x: s.foodPrev.x, y: s.foodPrev.y } : { ...food };

    man = { x: s.man.x, y: s.man.y };
    manPrev = validCell(s.manPrev) ? { x: s.manPrev.x, y: s.manPrev.y } : { ...man };

    score = s.score;
    scoreEl.textContent = score;
    tickInterval = typeof s.tickInterval === "number" ? s.tickInterval : Math.max(80, 135 - score * 2);
    manInterval = typeof s.manInterval === "number" ? s.manInterval : Math.max(150, 230 - score * 2);

    gameOver = false;
    paused = false; // resumeGame() decides whether to come back paused
  }

  // Continue the saved round: positions/score already applied, just start the
  // clocks so the timer keeps counting from where it left off (no reset to 0),
  // and never step before the player has the board, so no false collision.
  function resumeGame(s) {
    applySave(s);
    overlay.classList.add("hidden");
    overlayScore.hidden = true;
    submitRow.hidden = true;
    running = true;
    const now = performance.now();
    lastTick = now;
    lastManTick = now;
    // Anchor the start time so survival = elapsedMs and keeps growing.
    const elapsed = Math.max(0, Number(s.elapsedMs) || 0);
    gameStartTime = now - elapsed;
    pausedAccum = 0;
    if (s.paused) {
      // Come back paused exactly as the player left it.
      paused = true;
      pauseStarted = now;
    } else {
      paused = false;
    }
    pendingResume = null;
    saveGame(); // refresh the timestamp right away
  }

  // ---- Boot ---------------------------------------------------------------
  fitCanvas();

  // If this device has a valid, unfinished saved round, restore the board
  // behind the overlay and offer a Resume button. Otherwise, fresh setup.
  pendingResume = loadSave();
  if (pendingResume) {
    applySave(pendingResume);                       // show the saved board frozen
    overlayTitle.textContent = "Welcome back! 🐍";
    overlayText.textContent =
      "We saved your last run on this device. Pick up where you left off, or start over.";
    resumeBtn.hidden = false;
    resumeBtn.textContent = `▶ Resume (score ${pendingResume.score})`;
    startBtn.textContent = "New game";
    startBtn.classList.add("secondary");
    resumeBtn.focus();
  } else {
    reset();            // set up a frozen board behind the start overlay
  }

  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000); // keep the board fresh for everyone
  initVisits();                         // count this visit once per device
  setInterval(refreshVisits, 30000);    // keep the visit count current
  requestAnimationFrame(frame);
})();
