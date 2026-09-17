/* Platform Jumper — Doodle Jump style climber for Fun Games.
   Pure vanilla JS + HTML5 canvas. No dependencies.
   Bounce up when you land on a platform. Move left/right to climb.
   Score = height climbed. Fall off the bottom = game over. */

(() => {
  "use strict";

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Logical drawing space (portrait). Camera scrolls with the player.
  const W = 400;
  const H = 600;

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

  const btnLeft = document.getElementById("btn-left");
  const btnRight = document.getElementById("btn-right");

  // ---- Physics / tuning ---------------------------------------------------
  // World Y grows UPWARD (climbing). Gravity pulls Y down; bounce shoots Y up.
  const GRAVITY = 1600;
  const BOUNCE_V = 620;        // upward speed when landing on a platform
  const MOVE_SPEED = 280;      // left/right walk speed
  const PLAYER_W = 36;
  const PLAYER_H = 40;
  const PLAT_W = 70;
  const PLAT_H = 14;
  const BASE_GAP = 70;         // vertical gap between platforms (world units)
  const MAX_GAP = 95;          // wider at height; bounce reaches ~120, keep margin
  const GAP_JITTER = 10;       // random extra (was 18); max gap+jitter stays jumpable
  const MAX_DX = 130;          // max sideways shift from previous pad (reachable in air)
  const CAMERA_LINE = H * 0.4; // keep player near this screen line when rising

  // ---- Game state ---------------------------------------------------------
  // World Y grows UPWARD (like climbing a mountain). Screen y = cameraY - worldY.
  let playerX, playerY, playerVY;
  let platforms; // { x, y, w } in world coords (y = height)
  let cameraY;   // world Y of the TOP of the screen
  let score, best, maxHeight;
  let highestPlatY; // highest (largest Y) platform we've spawned
  let facing;    // 1 = right, -1 = left (for drawing)
  let running = false, gameOver = false;
  let scoreSubmitted = false;
  let lastTime = 0;

  // Input: keyboard + on-screen buttons + touch drag
  let keyLeft = false, keyRight = false;
  let btnHoldLeft = false, btnHoldRight = false;
  let dragActive = false, dragX = 0;

  best = Number(localStorage.getItem("platformBest") || 0);
  bestEl.textContent = best;

  function reset() {
    playerX = W / 2 - PLAYER_W / 2;
    playerY = 80;       // start a little above the first platform
    playerVY = 0;
    cameraY = H;
    platforms = [];
    score = 0;
    maxHeight = 0;
    facing = 1;
    scoreEl.textContent = "0";
    gameOver = false;

    // Starter platform under the player, then fill upward.
    platforms.push({ x: W / 2 - PLAT_W / 2, y: 40, w: PLAT_W });
    highestPlatY = 40;
    while (highestPlatY < cameraY + H) {
      spawnPlatformAbove();
    }
  }

  function gapForHeight(h) {
    // Gently harder as you climb: platforms get a bit farther apart.
    const t = Math.min(1, h / 4000);
    return BASE_GAP + (MAX_GAP - BASE_GAP) * t;
  }

  function spawnPlatformAbove() {
    const gap = gapForHeight(highestPlatY);
    highestPlatY += gap + Math.random() * GAP_JITTER;
    const w = PLAT_W - Math.floor(Math.random() * 12);
    // Place near the last pad so a bounce + move can always reach it.
    const prev = platforms[platforms.length - 1];
    let x = prev.x + (Math.random() * 2 - 1) * MAX_DX;
    x = Math.max(0, Math.min(W - w, x));
    platforms.push({ x, y: highestPlatY, w });
  }

  // ---- Controls -----------------------------------------------------------
  function wantLeft() {
    return keyLeft || btnHoldLeft;
  }
  function wantRight() {
    return keyRight || btnHoldRight;
  }

  window.addEventListener("keydown", (e) => {
    if (document.activeElement === nameInput) return;

    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      keyLeft = true;
      if (!running && !gameOver) startGame();
    }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      keyRight = true;
      if (!running && !gameOver) startGame();
    }
    if (e.key === " " || e.key === "Enter") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      if (document.activeElement === nameInput) return;
      e.preventDefault();
      if (!running) startGame();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keyLeft = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keyRight = false;
  });

  // On-screen buttons (pointer events cover mouse + touch)
  function holdBtn(which, on) {
    if (which === "left") {
      btnHoldLeft = on;
      btnLeft.classList.toggle("held", on);
    } else {
      btnHoldRight = on;
      btnRight.classList.toggle("held", on);
    }
    if (on && !running) startGame();
  }

  function bindDirBtn(el, which) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      holdBtn(which, true);
    });
    el.addEventListener("pointerup", () => holdBtn(which, false));
    el.addEventListener("pointercancel", () => holdBtn(which, false));
    el.addEventListener("pointerleave", () => holdBtn(which, false));
  }
  bindDirBtn(btnLeft, "left");
  bindDirBtn(btnRight, "right");

  // Touch / mouse drag on the canvas: player follows the finger/cursor x
  function canvasToGameX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!running || gameOver) return;
    e.preventDefault();
    dragActive = true;
    dragX = canvasToGameX(e.clientX);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragActive) return;
    dragX = canvasToGameX(e.clientX);
  });
  canvas.addEventListener("pointerup", () => { dragActive = false; });
  canvas.addEventListener("pointercancel", () => { dragActive = false; });

  startBtn.addEventListener("click", startGame);

  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (isTouch) document.body.classList.add("touch");

  // Optional: gentle tilt control on phones that support DeviceOrientation
  let tiltX = 0;
  let tiltEnabled = false;
  window.addEventListener("deviceorientation", (e) => {
    if (e.gamma == null) return;
    tiltEnabled = true;
    // gamma: left/right tilt in degrees; clamp so it isn't too twitchy
    tiltX = Math.max(-1, Math.min(1, e.gamma / 25));
  });

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

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    // Horizontal move
    let move = 0;
    if (wantLeft()) move -= 1;
    if (wantRight()) move += 1;
    if (tiltEnabled && move === 0 && !dragActive) {
      move = tiltX;
    }

    if (dragActive) {
      // Smoothly chase the drag point
      const target = dragX - PLAYER_W / 2;
      const dx = target - playerX;
      playerX += Math.max(-MOVE_SPEED * dt * 1.4, Math.min(MOVE_SPEED * dt * 1.4, dx));
      if (dx > 2) facing = 1;
      else if (dx < -2) facing = -1;
    } else if (move !== 0) {
      playerX += move * MOVE_SPEED * dt;
      facing = move > 0 ? 1 : -1;
    }

    // Wrap around left/right edges (classic doodle feel)
    if (playerX + PLAYER_W < 0) playerX = W;
    if (playerX > W) playerX = -PLAYER_W;

    // Gravity pulls downward (decreases world Y), then move
    playerVY -= GRAVITY * dt;
    const prevY = playerY;
    playerY += playerVY * dt;

    // Land on platforms only while falling (vy < 0 = moving down)
    if (playerVY < 0) {
      for (const p of platforms) {
        // Platform top is at p.y; player feet are at playerY
        // Crossing from above: was at/above the pad, now at/below it
        if (prevY >= p.y && playerY <= p.y) {
          const px = playerX + PLAYER_W * 0.15;
          const pw = PLAYER_W * 0.7;
          if (px + pw > p.x && px < p.x + p.w) {
            playerY = p.y;
            playerVY = BOUNCE_V;
            break;
          }
        }
      }
    }

    // Score = highest height reached (world Y)
    if (playerY > maxHeight) {
      maxHeight = playerY;
      const next = Math.floor(maxHeight / 10);
      if (next !== score) {
        score = next;
        scoreEl.textContent = String(score);
      }
    }

    // Camera follows upward only (platforms scroll down on screen)
    const playerScreenY = cameraY - playerY;
    if (playerScreenY < CAMERA_LINE) {
      cameraY = playerY + CAMERA_LINE;
    }

    // Spawn more platforms above as we climb
    while (highestPlatY < cameraY + H * 0.5) {
      spawnPlatformAbove();
    }

    // Drop platforms that fell far below the camera
    const minKeep = cameraY - H * 1.5;
    platforms = platforms.filter((p) => p.y > minKeep);

    // Fall off bottom of the screen = game over
    if (playerY < cameraY - H - 40) {
      endGame();
    }
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;
    dragActive = false;
    holdBtn("left", false);
    holdBtn("right", false);

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("platformBest", String(best));
    }

    overlayTitle.textContent = "Game Over 🦘";
    overlayText.textContent =
      "You fell! Climb again and beat your best height.";
    overlayScore.hidden = false;
    overlayScore.textContent = `You climbed ${score} point${score === 1 ? "" : "s"}!`;
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
  function worldToScreenY(wy) {
    return cameraY - wy;
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#7ec8ff");
    g.addColorStop(0.55, "#b8e4ff");
    g.addColorStop(1, "#e8f6ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft clouds that drift with camera (parallax-ish)
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    const base = (cameraY * 0.15) % 200;
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 97 + 40) % W);
      const cy = ((i * 130 - base) % H + H) % H;
      drawCloud(cx, cy, 28 + (i % 3) * 8);
    }
  }

  function drawCloud(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.arc(x + r * 0.5, y - r * 0.15, r * 0.45, 0, Math.PI * 2);
    ctx.arc(x + r, y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlatforms() {
    for (const p of platforms) {
      const sy = worldToScreenY(p.y);
      if (sy < -20 || sy > H + 20) continue;

      // Green grassy pad
      ctx.fillStyle = "#3d9a45";
      roundRect(p.x, sy - PLAT_H, p.w, PLAT_H, 6);
      ctx.fill();
      ctx.fillStyle = "#6fd86a";
      roundRect(p.x + 2, sy - PLAT_H + 1, p.w - 4, 5, 4);
      ctx.fill();
    }
  }

  function drawPlayer() {
    const sx = playerX;
    const sy = worldToScreenY(playerY) - PLAYER_H;

    ctx.save();
    ctx.translate(sx + PLAYER_W / 2, sy + PLAYER_H / 2);
    ctx.scale(facing, 1);

    // Body
    ctx.fillStyle = "#ff8fab";
    roundRect(-PLAYER_W / 2 + 4, -PLAYER_H / 2 + 8, PLAYER_W - 8, PLAYER_H - 12, 10);
    ctx.fill();

    // Head
    ctx.fillStyle = "#ffb3c6";
    ctx.beginPath();
    ctx.arc(2, -PLAYER_H / 2 + 10, 12, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(6, -PLAYER_H / 2 + 9, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(7, -PLAYER_H / 2 + 9, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Ears / spring vibe
    ctx.fillStyle = "#ff6b8a";
    ctx.beginPath();
    ctx.ellipse(-6, -PLAYER_H / 2 + 2, 4, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Feet
    ctx.fillStyle = "#e85a7a";
    roundRect(-PLAYER_W / 2 + 6, PLAYER_H / 2 - 8, 10, 6, 3);
    ctx.fill();
    roundRect(2, PLAYER_H / 2 - 8, 10, 6, 3);
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
    drawPlatforms();
    drawPlayer();

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
      lbNote.textContent = "No scores yet — be the first! 🦘";
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
      const res = await fetch("/api/platform/leaderboard", { cache: "no-store" });
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
      const res = await fetch("/api/platform/score", {
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
  // Global visit counter (one count per device)
  // ===================================================================
  function showVisits(n) {
    if (typeof n !== "number" || !isFinite(n)) {
      visitsCountEl.textContent = "—";
      return;
    }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    await FunDevice.visitOnce("platform", "/api/platform/visit", "/api/platform/visits", showVisits);
  }

  async function refreshVisits() {
    await FunDevice.visitOnce("platform", "/api/platform/visit", "/api/platform/visits", showVisits);
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
