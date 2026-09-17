/* Dino Run — classic Chrome-dino style runner for Fun Games.
   Pure vanilla JS + HTML5 canvas. No dependencies.
   Space / tap / click = jump. Hold Down / S = duck.
   Score = distance survived. Higher is better. */

(() => {
  "use strict";

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Logical drawing space (landscape), independent of the on-screen size.
  const W = 800;
  const H = 300;
  const GROUND_H = 48;
  const FLOOR = H - GROUND_H;

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

  // ---- Physics / tuning ---------------------------------------------------
  const GRAVITY = 2600;
  const JUMP_V = -620;
  const DINO_X = 90;
  const DINO_W = 44;
  const DINO_H = 48;
  const DINO_DUCK_H = 28;
  const BASE_SPEED = 280;
  const MAX_SPEED = 620;
  const SPEED_GAIN = 0.018; // extra speed per score point
  const SPAWN_MIN = 0.9;
  const SPAWN_MAX = 1.7;

  // ---- Game state ---------------------------------------------------------
  let dinoY, dinoV, ducking, onGround;
  let obstacles; // { x, w, h, kind: "cactus"|"rock"|"bird", y }
  let score, best, distance;
  let speed;
  let spawnTimer;
  let running = false, gameOver = false;
  let scoreSubmitted = false;
  let lastTime = 0;
  let legPhase = 0; // for run animation

  best = Number(localStorage.getItem("dinoBest") || 0);
  bestEl.textContent = best;

  function reset() {
    dinoY = FLOOR - DINO_H;
    dinoV = 0;
    ducking = false;
    onGround = true;
    obstacles = [];
    score = 0;
    distance = 0;
    speed = BASE_SPEED;
    spawnTimer = 1.2;
    scoreEl.textContent = "0";
    gameOver = false;
    legPhase = 0;
  }

  function dinoHitbox() {
    const h = ducking && onGround ? DINO_DUCK_H : DINO_H;
    const y = ducking && onGround ? FLOOR - h : dinoY;
    // Slightly smaller than the drawn sprite so hits feel fair.
    return { x: DINO_X + 6, y: y + 4, w: DINO_W - 12, h: h - 8 };
  }

  // ---- Controls -----------------------------------------------------------
  function jump() {
    if (!running || gameOver) return;
    if (onGround) {
      dinoV = JUMP_V;
      onGround = false;
      ducking = false;
    }
  }

  function setDuck(on) {
    if (!running || gameOver) return;
    ducking = on;
  }

  window.addEventListener("keydown", (e) => {
    if (document.activeElement === nameInput) return;

    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === "BUTTON") {
        if (running && !gameOver) jump();
        return;
      }
      if (running && !gameOver) jump();
      else if (!running) startGame();
    }
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      setDuck(true);
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      setDuck(false);
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    jump();
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      jump();
    },
    { passive: false }
  );

  startBtn.addEventListener("click", startGame);

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
    lastTime = performance.now();
  }

  // ---- Obstacles ----------------------------------------------------------
  function spawnObstacle() {
    const roll = Math.random();
    let kind, w, h, y;
    if (roll < 0.55) {
      // Small or tall cactus
      kind = "cactus";
      const tall = Math.random() < 0.4;
      w = tall ? 28 : 22;
      h = tall ? 56 : 38;
      y = FLOOR - h;
    } else if (roll < 0.8) {
      kind = "rock";
      w = 34 + Math.floor(Math.random() * 16);
      h = 22 + Math.floor(Math.random() * 10);
      y = FLOOR - h;
    } else {
      // Flying bird — duck under it
      kind = "bird";
      w = 36;
      h = 22;
      y = FLOOR - DINO_H - 18 - Math.floor(Math.random() * 20);
    }
    obstacles.push({ x: W + 20, w, h, kind, y });
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    // Score grows with distance run.
    distance += speed * dt;
    const nextScore = Math.floor(distance / 10);
    if (nextScore !== score) {
      score = nextScore;
      scoreEl.textContent = String(score);
    }
    speed = Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_GAIN * 100);

    // Jump physics
    if (!onGround) {
      dinoV += GRAVITY * dt;
      dinoY += dinoV * dt;
      if (dinoY >= FLOOR - DINO_H) {
        dinoY = FLOOR - DINO_H;
        dinoV = 0;
        onGround = true;
      }
    }

    if (onGround) legPhase += dt * (speed / 40);

    // Scroll obstacles
    for (const o of obstacles) {
      o.x -= speed * dt;
      if (o.kind === "bird") {
        // Gentle wing bob
        o.bob = (o.bob || 0) + dt * 8;
      }
    }
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -40) {
      obstacles.shift();
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      const gap = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      // Slightly faster spawns as speed rises
      spawnTimer = gap * (BASE_SPEED / speed);
    }

    // Collision
    const hit = dinoHitbox();
    for (const o of obstacles) {
      let oy = o.y;
      if (o.kind === "bird") oy = o.y + Math.sin(o.bob || 0) * 4;
      if (rectsOverlap(hit.x, hit.y, hit.w, hit.h, o.x + 4, oy + 2, o.w - 8, o.h - 4)) {
        return endGame();
      }
    }
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("dinoBest", String(best));
    }

    overlayTitle.textContent = "Game Over 🦕";
    overlayText.textContent =
      "Ouch! The dino tripped. Want to run again?";
    overlayScore.hidden = false;
    overlayScore.textContent = `You ran ${score} point${score === 1 ? "" : "s"}!`;
    startBtn.textContent = "Play Again";

    scoreSubmitted = false;
    submitStatus.hidden = true;
    submitStatus.className = "submit-status";
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit score";
    prepareNameInput();
    submitRow.hidden = false;
    replaceConfirm.hidden = true;

    overlay.classList.remove("hidden");
  }

  // ---- Drawing ------------------------------------------------------------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#c8e8ff");
    g.addColorStop(0.55, "#f4efe2");
    g.addColorStop(1, "#e8d9b0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft hills in the distance (parallax)
    const t = distance * 0.15;
    ctx.fillStyle = "rgba(180, 160, 120, 0.35)";
    for (let i = 0; i < 4; i++) {
      const hx = ((i * 280 - t) % (W + 280)) - 80;
      ctx.beginPath();
      ctx.ellipse(hx, FLOOR - 10, 120, 40, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sun
    ctx.fillStyle = "rgba(255, 220, 120, 0.85)";
    ctx.beginPath();
    ctx.arc(W - 70, 50, 28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGround() {
    ctx.fillStyle = "#c4a35a";
    ctx.fillRect(0, FLOOR, W, GROUND_H);
    ctx.fillStyle = "#8a7040";
    ctx.fillRect(0, FLOOR, W, 4);

    // Moving ground dashes
    ctx.strokeStyle = "rgba(90, 70, 40, 0.45)";
    ctx.lineWidth = 2;
    const offset = (distance * 0.5) % 40;
    for (let x = -offset; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, FLOOR + 14);
      ctx.lineTo(x + 18, FLOOR + 14);
      ctx.stroke();
    }
  }

  function drawDino() {
    const h = ducking && onGround ? DINO_DUCK_H : DINO_H;
    const y = ducking && onGround ? FLOOR - h : dinoY;
    const idle = !running && !gameOver ? Math.sin(performance.now() / 350) * 3 : 0;

    ctx.save();
    ctx.translate(DINO_X, y + idle);

    // Body
    ctx.fillStyle = "#5a9e5e";
    ctx.strokeStyle = "#3d7340";
    ctx.lineWidth = 2;
    roundRect(0, 0, DINO_W, h, 6);
    ctx.fill();
    ctx.stroke();

    // Belly
    ctx.fillStyle = "#8fd18a";
    roundRect(8, h * 0.45, DINO_W - 16, h * 0.4, 4);
    ctx.fill();

    // Head bump / snout
    if (!(ducking && onGround)) {
      ctx.fillStyle = "#5a9e5e";
      ctx.beginPath();
      ctx.ellipse(DINO_W - 4, 10, 14, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Eye
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(DINO_W + 2, 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(DINO_W + 3, 6, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Smile
      ctx.strokeStyle = "#3d7340";
      ctx.beginPath();
      ctx.arc(DINO_W + 4, 12, 5, 0.1, Math.PI - 0.1);
      ctx.stroke();
    } else {
      // Ducking: eye on the side
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(DINO_W - 10, 8, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(DINO_W - 9, 8, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legs (running)
    if (onGround && running && !gameOver) {
      const swing = Math.sin(legPhase) * 8;
      ctx.strokeStyle = "#3d7340";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(14, h - 2);
      ctx.lineTo(14 + swing, h + 10);
      ctx.moveTo(30, h - 2);
      ctx.lineTo(30 - swing, h + 10);
      ctx.stroke();
    } else if (!onGround) {
      ctx.strokeStyle = "#3d7340";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(14, h - 2);
      ctx.lineTo(8, h + 8);
      ctx.moveTo(30, h - 2);
      ctx.lineTo(36, h + 8);
      ctx.stroke();
    }

    // Tiny arm
    if (!(ducking && onGround)) {
      ctx.strokeStyle = "#3d7340";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(18, 22);
      ctx.lineTo(8, 28);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.kind === "cactus") drawCactus(o);
      else if (o.kind === "rock") drawRock(o);
      else drawBird(o);
    }
  }

  function drawCactus(o) {
    const g = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
    g.addColorStop(0, "#3d9e4a");
    g.addColorStop(0.5, "#5ecf6a");
    g.addColorStop(1, "#2f7a38");
    ctx.fillStyle = g;
    roundRect(o.x, o.y, o.w, o.h, 4);
    ctx.fill();
    // Arms
    ctx.fillRect(o.x - 10, o.y + o.h * 0.35, 12, 8);
    ctx.fillRect(o.x - 10, o.y + o.h * 0.25, 8, o.h * 0.25);
    ctx.fillRect(o.x + o.w - 2, o.y + o.h * 0.45, 12, 8);
    ctx.fillRect(o.x + o.w + 2, o.y + o.h * 0.35, 8, o.h * 0.2);
  }

  function drawRock(o) {
    ctx.fillStyle = "#8a7a68";
    ctx.beginPath();
    ctx.moveTo(o.x, o.y + o.h);
    ctx.lineTo(o.x + o.w * 0.2, o.y);
    ctx.lineTo(o.x + o.w * 0.7, o.y + 4);
    ctx.lineTo(o.x + o.w, o.y + o.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#a89880";
    ctx.beginPath();
    ctx.ellipse(o.x + o.w * 0.4, o.y + o.h * 0.5, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBird(o) {
    const bob = Math.sin(o.bob || 0) * 4;
    const y = o.y + bob;
    ctx.save();
    ctx.translate(o.x + o.w / 2, y + o.h / 2);

    // Wings flap
    const flap = Math.sin((o.bob || 0) * 2) * 0.5;
    ctx.fillStyle = "#5a6a8a";
    ctx.beginPath();
    ctx.ellipse(-6, flap * 6, 14, 5, -0.4 + flap, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, -flap * 6, 14, 5, 0.4 - flap, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = "#6a7a9a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#e8a040";
    ctx.beginPath();
    ctx.moveTo(10, -2);
    ctx.lineTo(18, 0);
    ctx.lineTo(10, 2);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(4, -3, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(4.5, -3, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

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
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (running && !gameOver) update(dt);

    drawBackground();
    drawGround();
    drawObstacles();
    drawDino();

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
      lbNote.textContent = "No scores yet — be the first! 🦕";
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
      const res = await fetch("/api/dino/leaderboard", { cache: "no-store" });
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

  // One shared player name for this device across all Fun Games (see device.js).
  function getSavedPlayerName() {
    return FunDevice.getName();
  }

  // Fill the name box. If this device already picked a name, lock the box so
  // they can only update THAT score (not invent a second person).
  function prepareNameInput() {
    if (FunDevice.isLocked()) {
      nameInput.value = FunDevice.getName();
      nameInput.readOnly = true;
    }
  }

  async function handleSubmitClick() {
    if (scoreSubmitted) return;

    let name = (nameInput.value || "").trim().slice(0, 16);
    if (FunDevice.isLocked()) {
      const locked = FunDevice.getName();
      if (normalizeName(name) !== normalizeName(locked)) {
        nameInput.value = locked;
        submitStatus.textContent = "This device is locked to \"" + locked + "\".";
        submitStatus.className = "submit-status taken";
        submitStatus.hidden = false;
        return;
      }
      name = locked;
    }
    nameInput.value = name;

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

    const locked = getSavedPlayerName();
    if (locked && normalizeName(name) === normalizeName(locked)) {
      // Returning device player — replace only (never invent a second person).
      const prevEntry = bestEntryForName(name);
      if (prevEntry) {
        showReplaceConfirm(name, prevEntry);
        return;
      }
      FunDevice.lockName(name);
      submitScore(name, true);
      return;
    }

    if (!nameIsTaken(name)) {
      FunDevice.lockName(name);
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
      const res = await fetch("/api/dino/score", {
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
      FunDevice.lockName(name);
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
    const name = getSavedPlayerName() || (nameInput.value || "").trim().slice(0, 16);
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
  // Global visit counter (up to 3 counts per device)
  // ===================================================================
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    await FunDevice.visitOnce("dino", "/api/dino/visit", "/api/dino/visits", showVisits, null, 3);
  }

  async function refreshVisits() {
    await FunDevice.visitOnce("dino", "/api/dino/visit", "/api/dino/visits", showVisits, null, 3);
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
