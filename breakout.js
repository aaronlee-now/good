/* Zoo Breakout — a classic brick-breaker with a zoo-fun palette, to match the
   other Fun Games. Pure vanilla JS + HTML5 canvas. No dependencies, works as
   static files. Bounce the ball off the paddle to smash every brick; clear a
   level to advance (endless high-score chase). Higher score is better. */

(() => {
  "use strict";

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Logical drawing space, independent of the on-screen size. The stage CSS
  // locks the 4:5 aspect ratio, so a single uniform scale keeps the ball round.
  const W = 480;
  const H = 600;

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * H) / W * dpr);
    const s = (cssW * dpr) / W;
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

  // Leaderboard + score-submission DOM.
  const submitRow = document.getElementById("submit-row");
  const nameInput = document.getElementById("name-input");
  const submitBtn = document.getElementById("submit-btn");
  const submitStatus = document.getElementById("submit-status");
  const lbList = document.getElementById("lb-list");
  const lbNote = document.getElementById("lb-note");

  // Global visit counter display.
  const visitsCountEl = document.getElementById("visits-count");

  // Replace-your-own-score confirmation DOM (returning player on this device).
  const replaceConfirm = document.getElementById("replace-confirm");
  const replaceWelcome = document.getElementById("replace-welcome");
  const replacePrev = document.getElementById("replace-prev");
  const replaceThis = document.getElementById("replace-this");
  const replaceVerdict = document.getElementById("replace-verdict");
  const replaceYes = document.getElementById("replace-yes");
  const replaceNo = document.getElementById("replace-no");

  // ---- Tuning (units are px and seconds) ----------------------------------
  const PADDLE_W = 96;           // paddle width
  const PADDLE_H = 16;           // paddle height
  const PADDLE_Y = H - 48;       // y of the paddle's TOP edge
  const PADDLE_SPEED = 620;      // keyboard move speed (px/s)
  const BALL_R = 8;              // ball radius
  const BASE_SPEED = 320;        // ball speed on level 1 (px/s)
  const SPEED_PER_LEVEL = 26;    // a little faster each level
  const MAX_SPEED = 560;         // never let the ball get unmanageably fast
  const MAX_BOUNCE = 1.15;       // max paddle bounce angle from vertical (rad)
  const LIVES_START = 3;

  // Brick grid.
  const COLS = 8;
  const ROWS = 5;
  const BRICK_TOP = 70;          // y where the first brick row begins
  const SIDE_PAD = 18;           // gap from the canvas left/right edges
  const BRICK_GAP = 6;           // gap between bricks
  const BRICK_H = 24;
  const BRICK_W = (W - 2 * SIDE_PAD - (COLS - 1) * BRICK_GAP) / COLS;

  // Each row gets a zoo-fun color and a point value (top rows are worth more).
  const ROW_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4dabf7"];
  function rowPoints(row) {
    return (ROWS - row) * 10;    // top row = 50, bottom row = 10
  }

  // ---- Game state ---------------------------------------------------------
  let paddleX;                   // paddle CENTER x
  let ball;                      // { x, y, vx, vy, stuck }
  let bricks;                    // array of { x, y, alive, color, points }
  let bricksLeft;
  let score, best, lives, level;
  let speed;                     // current ball speed magnitude
  let running = false, gameOver = false;
  let scoreSubmitted = false;    // guard so we don't submit the same run twice
  let lastTime = 0;              // timestamp of the previous animation frame

  // Keyboard hold state for smooth paddle movement.
  let leftHeld = false, rightHeld = false;

  best = Number(localStorage.getItem("breakoutBest") || 0);
  bestEl.textContent = best;

  function buildBricks() {
    bricks = [];
    bricksLeft = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        bricks.push({
          x: SIDE_PAD + c * (BRICK_W + BRICK_GAP),
          y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
          alive: true,
          color: ROW_COLORS[r % ROW_COLORS.length],
          points: rowPoints(r),
        });
        bricksLeft++;
      }
    }
  }

  // Park the ball on the paddle, waiting for a launch.
  function placeBallOnPaddle() {
    ball = {
      x: paddleX,
      y: PADDLE_Y - BALL_R - 1,
      vx: 0,
      vy: 0,
      stuck: true,
    };
  }

  function reset() {
    paddleX = W / 2;
    score = 0;
    lives = LIVES_START;
    level = 1;
    speed = BASE_SPEED;
    scoreEl.textContent = "0";
    buildBricks();
    placeBallOnPaddle();
    gameOver = false;
  }

  // Send the ball off the paddle: mostly upward, with a small random tilt.
  function launchBall() {
    if (!ball.stuck) return;
    ball.stuck = false;
    const angle = (Math.random() * 0.5 - 0.25); // small tilt from straight up
    ball.vx = speed * Math.sin(angle);
    ball.vy = -speed * Math.cos(angle);
  }

  // ---- Level + life flow --------------------------------------------------
  function nextLevel() {
    level++;
    speed = Math.min(MAX_SPEED, BASE_SPEED + (level - 1) * SPEED_PER_LEVEL);
    paddleX = W / 2;
    buildBricks();
    placeBallOnPaddle();
  }

  function loseLife() {
    lives--;
    if (lives <= 0) {
      endGame();
      return;
    }
    paddleX = W / 2;
    placeBallOnPaddle();
  }

  // ---- Controls -----------------------------------------------------------
  // Convert a client x (mouse/touch) into the logical 0..W coordinate space.
  function clientToLogicalX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const rel = (clientX - rect.left) / (rect.width || 1);
    return Math.max(0, Math.min(1, rel)) * W;
  }

  function setPaddleCenter(x) {
    const half = PADDLE_W / 2;
    paddleX = Math.max(half, Math.min(W - half, x));
    if (ball && ball.stuck) ball.x = paddleX;
  }

  // A single "launch or start" action used by click / Space / tap.
  function primaryAction() {
    if (!running) {
      startGame();
    } else if (!gameOver) {
      launchBall();
    }
  }

  // Keyboard: arrows / A / D move the paddle; Space launches. Arrows + Space
  // must NOT scroll the page.
  window.addEventListener("keydown", (e) => {
    // When the player is typing their name, let the input have every key.
    if (document.activeElement === nameInput) return;

    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      leftHeld = true;
      return;
    }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      rightHeld = true;
      return;
    }
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      // If a button (Start / Submit) is focused, let it handle the key itself.
      if (document.activeElement && document.activeElement.tagName === "BUTTON") {
        if (running && !gameOver) launchBall();
        return;
      }
      primaryAction();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") leftHeld = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") rightHeld = false;
  });

  // Mouse: moving over the board steers the paddle; clicking launches/starts.
  canvas.addEventListener("mousemove", (e) => {
    if (!running || gameOver) return;
    setPaddleCenter(clientToLogicalX(e.clientX));
  });
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    primaryAction();
  });

  // Touch: drag to move the paddle, tap to launch. preventDefault stops the
  // drag from scrolling/zooming the page and removes the 300ms tap delay.
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length) setPaddleCenter(clientToLogicalX(e.touches[0].clientX));
    primaryAction();
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (running && !gameOver && e.touches.length) {
      setPaddleCenter(clientToLogicalX(e.touches[0].clientX));
    }
  }, { passive: false });

  startBtn.addEventListener("click", startGame);

  // Detect touch capability automatically (never ask the player). Tag <body>
  // so any touch-only styling can apply; desktop stays untouched.
  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (isTouch) document.body.classList.add("touch");

  function startGame() {
    // Drop focus from the Start button. Otherwise the browser still treats
    // Space as "click the focused button", so pressing Space to launch would
    // re-fire Start → startGame() → the ball gets re-parked and never launches.
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    reset();
    overlay.classList.add("hidden");
    overlayScore.hidden = true;
    submitRow.hidden = true;
    replaceConfirm.hidden = true;
    running = true;
    gameOver = false;
    scoreSubmitted = false;
    lastTime = performance.now();
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    // Paddle movement from held keys.
    if (leftHeld) setPaddleCenter(paddleX - PADDLE_SPEED * dt);
    if (rightHeld) setPaddleCenter(paddleX + PADDLE_SPEED * dt);

    // While stuck, the ball rides the paddle and waits for a launch.
    if (ball.stuck) {
      ball.x = paddleX;
      ball.y = PADDLE_Y - BALL_R - 1;
      return;
    }

    // Move the ball in small sub-steps so a fast ball can't tunnel through a
    // brick or the paddle in a single frame.
    const dist = Math.hypot(ball.vx, ball.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / (BALL_R * 0.75)));
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (moveBall(sub)) return; // moveBall returns true if the round ended
    }
  }

  // Advance the ball by `dt` and resolve one round of collisions. Returns true
  // if this step ended the round (life lost / game over) so we stop stepping.
  function moveBall(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Side walls.
    if (ball.x - BALL_R < 0) {
      ball.x = BALL_R;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + BALL_R > W) {
      ball.x = W - BALL_R;
      ball.vx = -Math.abs(ball.vx);
    }
    // Ceiling.
    if (ball.y - BALL_R < 0) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
    }

    // Fell below the paddle → lose a life.
    if (ball.y - BALL_R > H) {
      loseLife();
      return true;
    }

    // Paddle bounce. Only when the ball is heading down and overlaps the paddle.
    const half = PADDLE_W / 2;
    if (
      ball.vy > 0 &&
      ball.y + BALL_R >= PADDLE_Y &&
      ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
      ball.x >= paddleX - half - BALL_R &&
      ball.x <= paddleX + half + BALL_R
    ) {
      ball.y = PADDLE_Y - BALL_R;
      // Where the ball hits the paddle (-1 left edge .. +1 right edge) sets the
      // rebound angle — classic Breakout feel.
      const hit = Math.max(-1, Math.min(1, (ball.x - paddleX) / half));
      const angle = hit * MAX_BOUNCE;
      ball.vx = speed * Math.sin(angle);
      ball.vy = -speed * Math.cos(angle);
    }

    // Brick collisions — resolve at most one brick per step.
    for (const b of bricks) {
      if (!b.alive) continue;
      if (
        ball.x + BALL_R < b.x ||
        ball.x - BALL_R > b.x + BRICK_W ||
        ball.y + BALL_R < b.y ||
        ball.y - BALL_R > b.y + BRICK_H
      ) {
        continue;
      }
      // Hit! Decide which side using the smallest overlap (x vs y).
      const overlapL = ball.x + BALL_R - b.x;
      const overlapR = b.x + BRICK_W - (ball.x - BALL_R);
      const overlapT = ball.y + BALL_R - b.y;
      const overlapB = b.y + BRICK_H - (ball.y - BALL_R);
      const minX = Math.min(overlapL, overlapR);
      const minY = Math.min(overlapT, overlapB);
      if (minX < minY) {
        ball.vx = -ball.vx;
        ball.x += overlapL < overlapR ? -minX : minX;
      } else {
        ball.vy = -ball.vy;
        ball.y += overlapT < overlapB ? -minY : minY;
      }

      b.alive = false;
      bricksLeft--;
      score += b.points;
      scoreEl.textContent = String(score);

      if (bricksLeft <= 0) nextLevel();
      break; // one brick per step keeps the bounce clean
    }
    return false;
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("breakoutBest", String(best));
    }

    overlayTitle.textContent = "Game Over 🧱";
    overlayText.textContent =
      "Out of lives! Your bricks were no match — fancy another round?";
    overlayScore.hidden = false;
    overlayScore.textContent = `You smashed your way to ${score} points!`;
    startBtn.textContent = "Play Again";

    // Get ready to submit this run to the global leaderboard.
    scoreSubmitted = false;
    submitStatus.hidden = true;
    submitStatus.className = "submit-status";
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit score";
    nameInput.value = localStorage.getItem("zooSnakeName") || "";
    submitRow.hidden = false;
    replaceConfirm.hidden = true;

    overlay.classList.remove("hidden");
  }

  // ---- Drawing ------------------------------------------------------------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a1c3a");
    g.addColorStop(1, "#0d0f24");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // A few faint "stars" / fireflies for a little zoo-at-night atmosphere.
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let i = 0; i < 24; i++) {
      const x = (i * 97) % W;
      const y = (i * 53) % (BRICK_TOP - 6) + 4;
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBricks() {
    for (const b of bricks) {
      if (!b.alive) continue;
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + BRICK_H);
      g.addColorStop(0, lighten(b.color, 0.18));
      g.addColorStop(1, b.color);
      ctx.fillStyle = g;
      roundRect(b.x, b.y, BRICK_W, BRICK_H, 5);
      ctx.fill();

      // Glossy top highlight.
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      roundRect(b.x + 3, b.y + 3, BRICK_W - 6, BRICK_H * 0.32, 3);
      ctx.fill();

      ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
      ctx.lineWidth = 1.5;
      roundRect(b.x, b.y, BRICK_W, BRICK_H, 5);
      ctx.stroke();
    }
  }

  function drawPaddle() {
    const x = paddleX - PADDLE_W / 2;
    const g = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H);
    g.addColorStop(0, "#9b7bff");
    g.addColorStop(1, "#6a48e0");
    ctx.fillStyle = g;
    roundRect(x, PADDLE_Y, PADDLE_W, PADDLE_H, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    roundRect(x + 4, PADDLE_Y + 3, PADDLE_W - 8, 4, 2);
    ctx.fill();
  }

  function drawBall() {
    const g = ctx.createRadialGradient(
      ball.x - BALL_R * 0.3, ball.y - BALL_R * 0.3, BALL_R * 0.2,
      ball.x, ball.y, BALL_R
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#ffd43b");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Heads-up display: score (top-left), level (center), lives (top-right).
  function drawHud() {
    if (!running && !gameOver) return;
    ctx.save();
    ctx.font = "bold 18px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textBaseline = "top";

    ctx.textAlign = "left";
    ctx.fillText(`Score ${score}`, 12, 10);

    ctx.textAlign = "center";
    ctx.fillText(`Level ${level}`, W / 2, 10);

    // Lives drawn as little balls on the right.
    ctx.textAlign = "right";
    for (let i = 0; i < lives; i++) {
      const lx = W - 14 - i * 18;
      ctx.fillStyle = "#ffd43b";
      ctx.beginPath();
      ctx.arc(lx, 18, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // "Tap / Space to launch" hint while the ball waits on the paddle.
    if (running && !gameOver && ball.stuck) {
      ctx.save();
      ctx.font = "bold 20px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Tap or press Space to launch", W / 2, H * 0.62);
      ctx.restore();
    }
  }

  // ---- Canvas utils -------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // Lighten a #rrggbb hex color toward white by amount t (0..1).
  function lighten(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lr = Math.round(r + (255 - r) * t);
    const lg = Math.round(g + (255 - g) * t);
    const lb = Math.round(b + (255 - b) * t);
    return `rgb(${lr}, ${lg}, ${lb})`;
  }

  // ---- Main loop ----------------------------------------------------------
  function frame(now) {
    // Seconds since the last frame, clamped so a background tab can't teleport
    // the ball across the board when it returns.
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (running && !gameOver) update(dt);

    drawBackground();
    drawBricks();
    drawPaddle();
    if (ball) drawBall();
    drawHud();

    requestAnimationFrame(frame);
  }

  // ===================================================================
  // Global leaderboard — HIGHEST score first (ties: earliest submission)
  // ===================================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Fold a name to the same identity key the server uses (trim + lowercase).
  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  // Highlight the row matching the score we just submitted.
  let highlight = null;     // { name, score } or null
  let currentScores = [];   // latest collapsed board (best per name), best-first

  // Positive if `a` ranks AHEAD of `b`: HIGHER score wins; tie → earlier ts.
  function rankCompare(a, b) {
    const ds = (Number(a.score) || 0) - (Number(b.score) || 0);
    if (ds !== 0) return ds;
    return (Number(b.ts) || 0) - (Number(a.ts) || 0);
  }

  // Collapse an append-only board to ONE entry per normalized name, keeping
  // each player's BEST (highest) score. Result is sorted best-first.
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
      lbNote.textContent = "No scores yet — be the first! 🧱";
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
      const res = await fetch("/api/breakout/leaderboard", { cache: "no-store" });
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

  // "Better" = HIGHER score. A tie does NOT beat your old score.
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
      const res = await fetch("/api/breakout/score", {
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
    const VISIT_KEY = "breakoutCounted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(firstOnThisDevice ? "/api/breakout/visit" : "/api/breakout/visits", {
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
      const res = await fetch("/api/breakout/visits", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      showVisits(Number(data.visits));
    } catch (err) {
      /* keep whatever is shown */
    }
  }

  // ---- Boot ---------------------------------------------------------------
  fitCanvas();
  reset();
  running = false;
  gameOver = false;

  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000);
  initVisits();
  setInterval(refreshVisits, 30000);
  requestAnimationFrame(frame);
})();
