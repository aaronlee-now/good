/* Flappy Parrot — a one-tap flyer with a zoo theme, to match Zoo Snake.
   Pure vanilla JS + HTML5 canvas. No dependencies, works as static files.
   Tap / click / Space makes the parrot flap; gravity always pulls it down.
   Fly through the gaps in the vines. Higher score is better. */

(() => {
  "use strict";

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Logical drawing space (portrait), independent of the on-screen size.
  const W = 400;
  const H = 600;
  const GROUND_H = 70;            // height of the grassy ground strip
  const FLOOR = H - GROUND_H;     // y of the top of the ground

  // Keep the canvas crisp on high-DPI screens while we draw in a fixed
  // 0..W by 0..H coordinate space. The stage CSS locks the 2:3 aspect ratio,
  // so scaling by the width factor keeps circles round (uniform scale).
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || W;
    const cssH = canvas.clientHeight || H;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
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

  // ---- Physics tuning (units are px and seconds) --------------------------
  const GRAVITY = 1500;          // downward acceleration
  const FLAP = -430;             // instant upward velocity from a flap
  const MAX_FALL = 620;          // terminal downward speed
  const PIPE_SPEED = 155;        // how fast vines scroll left
  const PIPE_W = 64;             // vine column width
  const PIPE_GAP = 175;          // vertical opening the parrot flies through
  const PIPE_SPACING = 230;      // horizontal distance between vine pairs
  const GAP_MARGIN = 60;         // keep gaps away from the very top/bottom
  const BIRD_X = 112;            // parrot's fixed horizontal position
  const BIRD_R = 16;             // parrot collision radius

  // ---- Game state ---------------------------------------------------------
  let birdY, birdV, birdAngle;
  let pipes;                     // array of { x, gapY, passed }
  let score, best;
  let running = false, gameOver = false;
  let scoreSubmitted = false;    // guard so we don't submit the same run twice
  let lastTime = 0;              // timestamp of the previous animation frame

  best = Number(localStorage.getItem("flappyBest") || 0);
  bestEl.textContent = best;

  function reset() {
    birdY = H * 0.45;
    birdV = 0;
    birdAngle = 0;
    pipes = [];
    score = 0;
    scoreEl.textContent = "0";
    gameOver = false;
    // Seed the first vine pair off the right edge so there's a moment to react.
    spawnPipe(W + 120);
  }

  function randomGapY() {
    const min = GAP_MARGIN + PIPE_GAP / 2;
    const max = FLOOR - GAP_MARGIN - PIPE_GAP / 2;
    return min + Math.random() * (max - min);
  }

  function spawnPipe(x) {
    pipes.push({ x, gapY: randomGapY(), passed: false });
  }

  // ---- Controls -----------------------------------------------------------
  // A single "flap" impulse. Used by every input route (keyboard, click, tap).
  function flap() {
    if (!running || gameOver) return;
    birdV = FLAP;
  }

  // Keyboard: Space / ArrowUp / W flap. Space must NOT scroll the page.
  window.addEventListener("keydown", (e) => {
    // When the player is typing their name, let the input have every key.
    if (document.activeElement === nameInput) return;

    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      // If a button (Start / Submit) is focused, let it handle the key itself.
      if (document.activeElement && document.activeElement.tagName === "BUTTON") {
        if (running && !gameOver) flap();
        return;
      }
      if (running && !gameOver) flap();
      else if (!running) startGame();
    }
  });

  // Mouse: clicking the board flaps. The overlay covers the canvas when the
  // game isn't running, so a click here only happens during play.
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    flap();
  });

  // Touch: tap anywhere on the board to flap. preventDefault removes the 300ms
  // tap delay + ghost click and stops the tap from scrolling or zooming.
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    flap();
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
    reset();
    overlay.classList.add("hidden");
    overlayScore.hidden = true;
    submitRow.hidden = true;
    replaceConfirm.hidden = true;
    running = true;
    gameOver = false;
    scoreSubmitted = false;
    birdV = FLAP * 0.7; // a gentle starting hop so the parrot doesn't drop
    lastTime = performance.now();
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    // Gravity pulls the parrot down; flapping set a negative (upward) velocity.
    birdV = Math.min(MAX_FALL, birdV + GRAVITY * dt);
    birdY += birdV * dt;

    // Tilt the parrot: nose up while rising, nose down while falling.
    const target = Math.max(-0.5, Math.min(1.2, birdV / 520));
    birdAngle += (target - birdAngle) * Math.min(1, dt * 10);

    // Scroll the vines left and score when the parrot clears a pair.
    for (const p of pipes) {
      p.x -= PIPE_SPEED * dt;
      if (!p.passed && p.x + PIPE_W < BIRD_X) {
        p.passed = true;
        score++;
        scoreEl.textContent = String(score);
      }
    }
    // Drop vines that have fully scrolled off the left edge.
    while (pipes.length && pipes[0].x + PIPE_W < -20) pipes.shift();

    // Add a new vine pair once the last one is far enough in.
    const last = pipes[pipes.length - 1];
    if (!last || last.x < W - PIPE_SPACING) spawnPipe(W);

    // Ceiling and ground are both fatal.
    if (birdY - BIRD_R <= 0) return endGame();
    if (birdY + BIRD_R >= FLOOR) return endGame();

    // Vine collision (circle vs the two rectangles of each pair).
    for (const p of pipes) {
      const gapTop = p.gapY - PIPE_GAP / 2;
      const gapBottom = p.gapY + PIPE_GAP / 2;
      if (
        circleHitsRect(BIRD_X, birdY, BIRD_R, p.x, 0, PIPE_W, gapTop) ||
        circleHitsRect(BIRD_X, birdY, BIRD_R, p.x, gapBottom, PIPE_W, FLOOR - gapBottom)
      ) {
        return endGame();
      }
    }
  }

  // Closest-point circle/rectangle overlap test.
  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("flappyBest", String(best));
    }

    overlayTitle.textContent = "Game Over 🦜";
    overlayText.textContent =
      "Your parrot clipped a vine! Want to take another flight?";
    overlayScore.hidden = false;
    overlayScore.textContent =
      `You flew past ${score} vine${score === 1 ? "" : "s"}!`;
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
    // Sky gradient.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#8fd0ff");
    g.addColorStop(1, "#d8f1ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // A warm sun in the corner.
    ctx.fillStyle = "rgba(255, 236, 150, 0.9)";
    ctx.beginPath();
    ctx.arc(W - 64, 70, 38, 0, Math.PI * 2);
    ctx.fill();

    // Drifting clouds (slow parallax based on the clock).
    drawClouds();
  }

  function drawClouds() {
    const t = performance.now() / 60;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const clouds = [
      { x: 80, y: 110, s: 1.0 },
      { x: 260, y: 180, s: 1.3 },
      { x: 150, y: 300, s: 0.85 },
    ];
    for (const c of clouds) {
      // Wrap horizontally so clouds loop forever.
      let x = (c.x - t * 0.6 * c.s) % (W + 120);
      if (x < -120) x += W + 120;
      cloud(x, c.y, 26 * c.s);
    }
  }

  function cloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r, y + 6, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x - r, y + 8, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x + r * 0.4, y - r * 0.5, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPipes() {
    for (const p of pipes) {
      const gapTop = p.gapY - PIPE_GAP / 2;
      const gapBottom = p.gapY + PIPE_GAP / 2;
      drawVine(p.x, 0, PIPE_W, gapTop, false);
      drawVine(p.x, gapBottom, PIPE_W, FLOOR - gapBottom, true);
    }
  }

  // A leafy green "vine" column. `capAtTop` puts the leafy mouth at the gap.
  function drawVine(x, y, w, h, capAtTop) {
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#4a9e36");
    g.addColorStop(0.5, "#74c94f");
    g.addColorStop(1, "#3c8a2c");
    ctx.fillStyle = g;
    roundRect(x, y, w, h, 8);
    ctx.fill();

    // Darker outline for a little depth.
    ctx.strokeStyle = "#2f6b22";
    ctx.lineWidth = 3;
    roundRect(x, y, w, h, 8);
    ctx.stroke();

    // The leafy "cap" ring at the end nearest the gap.
    const capY = capAtTop ? y : y + h - 18;
    ctx.fillStyle = "#3f8f2e";
    roundRect(x - 5, capY, w + 10, 18, 6);
    ctx.fill();
    ctx.strokeStyle = "#2f6b22";
    ctx.lineWidth = 2;
    roundRect(x - 5, capY, w + 10, 18, 6);
    ctx.stroke();

    // A couple of little leaves poking out for the jungle look.
    ctx.fillStyle = "#8ed95f";
    const ly = capAtTop ? y + 22 : capY - 10;
    leaf(x + w * 0.18, ly, 7, -0.6);
    leaf(x + w * 0.82, ly, 7, 0.6);
  }

  function leaf(cx, cy, r, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGround() {
    // Grass strip.
    const g = ctx.createLinearGradient(0, FLOOR, 0, H);
    g.addColorStop(0, "#7cc35a");
    g.addColorStop(1, "#5fa83e");
    ctx.fillStyle = g;
    ctx.fillRect(0, FLOOR, W, GROUND_H);

    // A darker soil line at the top of the ground.
    ctx.fillStyle = "#4a7d2f";
    ctx.fillRect(0, FLOOR, W, 6);

    // Simple moving grass tufts so the ground feels like it scrolls.
    const t = (performance.now() / 1000) * PIPE_SPEED;
    ctx.strokeStyle = "rgba(40, 90, 30, 0.5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let gx = (i * 32 - (running ? t : 0)) % (W + 32);
      if (gx < -32) gx += W + 32;
      ctx.beginPath();
      ctx.moveTo(gx, FLOOR + 16);
      ctx.lineTo(gx + 4, FLOOR + 8);
      ctx.lineTo(gx + 8, FLOOR + 16);
      ctx.stroke();
    }
  }

  function drawBird() {
    // A gentle bob while waiting on the start/idle screen.
    const idle = !running && !gameOver ? Math.sin(performance.now() / 300) * 6 : 0;
    const y = birdY + idle;

    ctx.save();
    ctx.translate(BIRD_X, y);
    ctx.rotate(birdAngle);

    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(0, BIRD_R + 6, BIRD_R, BIRD_R * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail feathers.
    ctx.fillStyle = "#e23b5a";
    ctx.beginPath();
    ctx.moveTo(-BIRD_R * 0.8, 0);
    ctx.lineTo(-BIRD_R * 1.7, -BIRD_R * 0.5);
    ctx.lineTo(-BIRD_R * 1.6, BIRD_R * 0.5);
    ctx.closePath();
    ctx.fill();

    // Body (green parrot with a glossy gradient).
    const bg = ctx.createLinearGradient(0, -BIRD_R, 0, BIRD_R);
    bg.addColorStop(0, "#6ee06a");
    bg.addColorStop(1, "#2faa46");
    ctx.fillStyle = bg;
    ctx.strokeStyle = "#1f7a32";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, BIRD_R * 1.1, BIRD_R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Wing — flaps with the rising/falling motion.
    const wingUp = birdV < 0;
    ctx.fillStyle = "#2faa46";
    ctx.beginPath();
    if (wingUp) {
      ctx.ellipse(-2, -2, BIRD_R * 0.6, BIRD_R * 0.42, -0.6, 0, Math.PI * 2);
    } else {
      ctx.ellipse(-2, 4, BIRD_R * 0.6, BIRD_R * 0.42, 0.5, 0, Math.PI * 2);
    }
    ctx.fill();

    // Cheek patch.
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(BIRD_R * 0.45, BIRD_R * 0.2, BIRD_R * 0.28, 0, Math.PI * 2);
    ctx.fill();

    // Beak.
    ctx.fillStyle = "#ff9a3c";
    ctx.beginPath();
    ctx.moveTo(BIRD_R * 0.95, -BIRD_R * 0.1);
    ctx.lineTo(BIRD_R * 1.7, BIRD_R * 0.1);
    ctx.lineTo(BIRD_R * 0.95, BIRD_R * 0.35);
    ctx.closePath();
    ctx.fill();

    // Eye.
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(BIRD_R * 0.5, -BIRD_R * 0.35, BIRD_R * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(BIRD_R * 0.58, -BIRD_R * 0.35, BIRD_R * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawScore() {
    if (!running || gameOver) return;
    ctx.save();
    ctx.font = "bold 48px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.fillStyle = "#fff";
    ctx.strokeText(String(score), W / 2, 70);
    ctx.fillText(String(score), W / 2, 70);
    ctx.restore();
  }

  // ---- Canvas path util ---------------------------------------------------
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

  // ---- Main loop ----------------------------------------------------------
  function frame(now) {
    // Seconds since the last frame, clamped so a background tab can't teleport
    // the parrot through a vine when it returns.
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (running && !gameOver) update(dt);

    drawBackground();
    drawPipes();
    drawGround();
    drawBird();
    drawScore();

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
      lbNote.textContent = "No scores yet — be the first! 🦜";
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
      const res = await fetch("/api/flappy/leaderboard", { cache: "no-store" });
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
      const res = await fetch("/api/flappy/score", {
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
  // Global visit counter (independent from Snake / Chess)
  // ===================================================================
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    const VISIT_KEY = "flappyCounted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(firstOnThisDevice ? "/api/flappy/visit" : "/api/flappy/visits", {
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
      const res = await fetch("/api/flappy/visits", { cache: "no-store" });
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
