/**
 * Claw Time — a simple claw machine game.
 * Move the claw left/right, then drop it to grab a prize.
 */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ticketsEl = document.getElementById("tickets");
const triesEl = document.getElementById("tries");
const lastPrizeEl = document.getElementById("last-prize");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const startBtn = document.getElementById("start-btn");
const btnLeft = document.getElementById("btn-left");
const btnRight = document.getElementById("btn-right");
const btnDrop = document.getElementById("btn-drop");

// Different prizes: name, tickets won, color, size, how easy to grab
const PRIZE_TYPES = [
  { name: "Candy", tickets: 5, color: "#ff6b9d", r: 18, grabChance: 0.85 },
  { name: "Duck", tickets: 10, color: "#ffd93d", r: 22, grabChance: 0.7 },
  { name: "Bear", tickets: 20, color: "#c48a4a", r: 26, grabChance: 0.55 },
  { name: "Star", tickets: 40, color: "#5ce1ff", r: 20, grabChance: 0.4 },
  { name: "Crown", tickets: 80, color: "#ffe566", r: 24, grabChance: 0.25 },
];

const W = canvas.width;
const H = canvas.height;
const FLOOR_Y = H - 36;
const CLAW_SPEED = 3.2;
const DROP_SPEED = 5.5;
const LIFT_SPEED = 4.2;
const TRIES_PER_GAME = 3;

let tickets = 0;
let triesLeft = TRIES_PER_GAME;
let playing = false;
let clawBusy = false;

// Claw state
let clawX = W / 2;
let clawY = 40;
let clawOpen = true;
let heldPrize = null;
let moveLeft = false;
let moveRight = false;

// Prizes sitting in the bin
let prizes = [];

function randomPrizeType() {
  // Common prizes more often, crown less often
  const roll = Math.random();
  if (roll < 0.3) return PRIZE_TYPES[0];
  if (roll < 0.55) return PRIZE_TYPES[1];
  if (roll < 0.75) return PRIZE_TYPES[2];
  if (roll < 0.92) return PRIZE_TYPES[3];
  return PRIZE_TYPES[4];
}

function spawnPrizes() {
  prizes = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const type = randomPrizeType();
    const x = 50 + Math.random() * (W - 100);
    const y = FLOOR_Y - type.r - Math.random() * 50;
    prizes.push({
      type,
      x,
      y,
      vx: (Math.random() - 0.5) * 0.4,
    });
  }
}

function setControlsEnabled(on) {
  btnLeft.disabled = !on;
  btnRight.disabled = !on;
  btnDrop.disabled = !on || clawBusy;
}

function updateHud() {
  ticketsEl.textContent = String(tickets);
  triesEl.textContent = String(triesLeft);
}

function showOverlay(title, text, buttonLabel) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  startBtn.textContent = buttonLabel;
  overlay.classList.remove("hidden");
  setControlsEnabled(false);
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function startGame() {
  tickets = 0;
  triesLeft = TRIES_PER_GAME;
  clawX = W / 2;
  clawY = 40;
  clawOpen = true;
  heldPrize = null;
  clawBusy = false;
  playing = true;
  lastPrizeEl.textContent = "—";
  spawnPrizes();
  updateHud();
  hideOverlay();
  setControlsEnabled(true);
}

function endGame() {
  playing = false;
  setControlsEnabled(false);
  showOverlay(
    "Round over!",
    "You earned " + tickets + " tickets. Want to play again?",
    "Start Now"
  );
}

function tryGrab() {
  // Find the prize closest to the claw tip
  const tipY = clawY + 55;
  let best = null;
  let bestDist = Infinity;

  for (const p of prizes) {
    const dx = p.x - clawX;
    const dy = p.y - tipY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const reach = 26 + p.type.r * 0.4;
    if (dist < reach && dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }

  if (!best) return null;

  // Harder prizes slip away more often
  if (Math.random() > best.type.grabChance) {
    return null;
  }

  // Remove from bin and hold it
  prizes = prizes.filter((p) => p !== best);
  return best;
}

function finishDrop(caught) {
  clawBusy = false;
  clawOpen = true;
  heldPrize = null;
  clawY = 40;

  if (caught) {
    tickets += caught.type.tickets;
    lastPrizeEl.textContent = caught.type.name + " +" + caught.type.tickets;
    updateHud();
  } else {
    lastPrizeEl.textContent = "Miss!";
  }

  // Add a new prize so the bin stays fun
  if (prizes.length < 6) {
    const type = randomPrizeType();
    prizes.push({
      type,
      x: 50 + Math.random() * (W - 100),
      y: FLOOR_Y - type.r - Math.random() * 40,
      vx: (Math.random() - 0.5) * 0.4,
    });
  }

  triesLeft -= 1;
  updateHud();
  setControlsEnabled(true);

  if (triesLeft <= 0) {
    endGame();
  }
}

function dropClaw() {
  if (!playing || clawBusy) return;
  clawBusy = true;
  clawOpen = true;
  setControlsEnabled(false);

  // 1) Go down
  function goDown() {
    clawY += DROP_SPEED;
    if (clawY < FLOOR_Y - 70) {
      requestAnimationFrame(goDown);
      return;
    }
    // 2) Snap shut and maybe grab
    clawOpen = false;
    heldPrize = tryGrab();
    setTimeout(goUp, 280);
  }

  // 3) Lift back up
  function goUp() {
    clawY -= LIFT_SPEED;
    if (heldPrize) {
      heldPrize.x = clawX;
      heldPrize.y = clawY + 58;
    }
    if (clawY > 40) {
      requestAnimationFrame(goUp);
      return;
    }
    const caught = heldPrize;
    finishDrop(caught);
  }

  goDown();
}

function updatePrizes() {
  for (const p of prizes) {
    p.x += p.vx;
    if (p.x < 30 + p.type.r || p.x > W - 30 - p.type.r) {
      p.vx *= -1;
    }
    // Soft settle toward floor
    const rest = FLOOR_Y - p.type.r;
    if (p.y < rest) {
      p.y += 0.6;
    } else {
      p.y = rest;
    }
  }
}

function drawBackground() {
  // Glass tint
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#b8e4f4");
  g.addColorStop(1, "#7ebfd8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Soft light spots
  ctx.fillStyle = "rgba(255, 255, 200, 0.18)";
  ctx.beginPath();
  ctx.arc(80, 60, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(340, 100, 40, 0, Math.PI * 2);
  ctx.fill();

  // Floor / prize chute
  ctx.fillStyle = "#5a3a28";
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  ctx.fillStyle = "#7a5040";
  ctx.fillRect(0, FLOOR_Y, W, 6);

  // Side walls
  ctx.fillStyle = "rgba(40, 80, 110, 0.35)";
  ctx.fillRect(0, 0, 18, H);
  ctx.fillRect(W - 18, 0, 18, H);
}

function drawPrize(p, isHeld) {
  const { x, y, type } = p;
  const r = type.r;

  // Shadow
  if (!isHeld) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x, FLOOR_Y - 2, r * 0.9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = type.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Shine
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.fill();

  // Name
  ctx.fillStyle = "#1a1010";
  ctx.font = "bold 11px Nunito, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type.name, x, y);
}

function drawClaw() {
  // Cable
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(clawX, 0);
  ctx.lineTo(clawX, clawY);
  ctx.stroke();

  // Motor box
  ctx.fillStyle = "#e8c040";
  ctx.strokeStyle = "#8a6010";
  ctx.lineWidth = 2;
  ctx.fillRect(clawX - 16, clawY - 8, 32, 18);
  ctx.strokeRect(clawX - 16, clawY - 8, 32, 18);

  // Arms
  const open = clawOpen ? 22 : 10;
  ctx.strokeStyle = "#d0d0d8";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(clawX - 6, clawY + 10);
  ctx.lineTo(clawX - open, clawY + 48);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(clawX + 6, clawY + 10);
  ctx.lineTo(clawX + open, clawY + 48);
  ctx.stroke();

  // Tips
  ctx.fillStyle = "#ff5c8a";
  ctx.beginPath();
  ctx.arc(clawX - open, clawY + 48, 5, 0, Math.PI * 2);
  ctx.arc(clawX + open, clawY + 48, 5, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  drawBackground();

  for (const p of prizes) {
    drawPrize(p, false);
  }

  drawClaw();

  if (heldPrize) {
    drawPrize(heldPrize, true);
  }
}

function tick() {
  if (playing && !clawBusy) {
    if (moveLeft) clawX -= CLAW_SPEED;
    if (moveRight) clawX += CLAW_SPEED;
    clawX = Math.max(40, Math.min(W - 40, clawX));
  }

  if (playing) {
    updatePrizes();
  }

  draw();
  requestAnimationFrame(tick);
}

// —— Input ——
startBtn.addEventListener("click", startGame);

btnLeft.addEventListener("mousedown", () => { moveLeft = true; });
btnLeft.addEventListener("mouseup", () => { moveLeft = false; });
btnLeft.addEventListener("mouseleave", () => { moveLeft = false; });
btnLeft.addEventListener("touchstart", (e) => { e.preventDefault(); moveLeft = true; }, { passive: false });
btnLeft.addEventListener("touchend", () => { moveLeft = false; });

btnRight.addEventListener("mousedown", () => { moveRight = true; });
btnRight.addEventListener("mouseup", () => { moveRight = false; });
btnRight.addEventListener("mouseleave", () => { moveRight = false; });
btnRight.addEventListener("touchstart", (e) => { e.preventDefault(); moveRight = true; }, { passive: false });
btnRight.addEventListener("touchend", () => { moveRight = false; });

btnDrop.addEventListener("click", dropClaw);

document.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft") {
    moveLeft = true;
    e.preventDefault();
  }
  if (e.code === "ArrowRight") {
    moveRight = true;
    e.preventDefault();
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!overlay.classList.contains("hidden")) {
      startGame();
    } else {
      dropClaw();
    }
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft") moveLeft = false;
  if (e.code === "ArrowRight") moveRight = false;
});

// First paint (idle machine behind overlay)
spawnPrizes();
setControlsEnabled(false);
updateHud();
tick();
