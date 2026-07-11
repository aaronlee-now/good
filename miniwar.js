/* Mini War — an original "build an economy, raise an army, conquer territory"
   battler, inspired by the country-conquest tycoon genre (NOT a copy of any
   specific game's maps, art, or assets). Pure vanilla JS + HTML5 canvas.

   The loop: earn cash over time, spend it on ECONOMY buildings to grow your
   income, research deep tech chains, sell goods on a swinging MARKET, then
   raise an army that marches up the field to smash the enemy outpost. Capture
   an outpost to take its territory — each new region is tougher. Hold your own
   base or it's game over.

   You also command a COMMANDER avatar you walk around the battlefield:
     • Desktop: WASD or Arrow keys move your commander (8-direction).
     • Mobile: drag anywhere on the board to steer a virtual joystick.
   Where the commander stands matters: new troops RALLY to the commander, walk
   them up to the enemy outpost to LEAD THE ASSAULT (extra damage), retreat to
   your base to REPAIR it, and roam to grab the COINS fallen enemies drop.

   Build controls (mirror the tap/click menu so PC players can play fast):
     • Click / tap any build button to buy it.
     • Keys 1-5 spawn units, Q/E/R/F buy economy, T a tower, G sells goods.
     • Space / Enter starts (or resumes) the game.
   Your run AUTO-SAVES to this device — including your commander's position —
   so come back later to resume right where you left off. */

(() => {
  "use strict";

  // ---- Canvas setup -------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
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
  const territoryEl = document.getElementById("wave"); // pill repurposed: Territory
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayScore = document.getElementById("overlay-score");
  const idleNote = document.getElementById("idle-note");
  const startBtn = document.getElementById("start-btn");
  const shopEl = document.getElementById("shop");

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

  // ---- Economy + unit definitions ----------------------------------------
  const BASE_INCOME = 4;               // cash/sec before any buildings
  const START_CASH = 130;
  const MY_BASE_HP = 850;
  const FIELD_TOP = 64;                // enemy outpost line
  const FIELD_BOTTOM = H - 64;         // your base line
  const MAX_UNITS_PER_SIDE = 90;       // perf guard

  const MAX_TOWERS = 6;

  // ---- Commander avatar (the character you walk around) ------------------
  const PLAYER_SPEED = 158;            // px/sec
  const PLAYER_R = 11;
  const ASSAULT_DPS = 28;              // dmg/sec your commander deals at the front
  const REPAIR_PER_SEC = 22;           // base HP/sec your commander restores at home
  const ENEMY_ZONE_Y = FIELD_TOP + 50; // commander leads the assault above this line
  const BASE_ZONE_Y = FIELD_BOTTOM - 50; // commander repairs the base below this line
  const PLAYER_MIN_X = PLAYER_R + 4;
  const PLAYER_MAX_X = W - PLAYER_R - 4;
  const PLAYER_MIN_Y = FIELD_TOP + 4;
  const PLAYER_MAX_Y = FIELD_BOTTOM + 10;
  const COIN_LIFE = 9;                 // seconds a dropped coin lingers
  const COIN_PICK_R = 22;              // pickup radius
  const JOY_MAX = 46;                  // joystick travel radius (game px)

  // Economy + research buildings. Cost grows with how many you already own.
  // `prereq(counts)` (optional) gates a node until its requirement is met.
  // `cap` (optional) limits how many can be owned (used for one-time unlocks).
  const ECON = {
    farm:       { base: 50,   growth: 1.55, label: "🌾 Farm" },
    workshop:   { base: 180,  growth: 1.85, label: "🔧 Workshop" },
    bank:       { base: 600,  growth: 1.7,  label: "🏦 Bank" },
    powerplant: { base: 2200, growth: 1.95, label: "⚡ Power Plant" },

    // --- Military research chain: Army Training → Officer → Elite Corps ---
    training:   { base: 350,   growth: 1.7,  label: "🔬 Army Training" },
    officer:    { base: 2500,  growth: 1.8,  label: "🎖️ Officer", prereq: (c) => c.training >= 3 },
    elite:      { base: 15000, growth: 1,    cap: 1, label: "⭐ Elite Corps", prereq: (c) => c.officer >= 1 },

    // --- Economy research chain: Fast Workers → Mass Production ---
    workers:    { base: 500,   growth: 1.8,  label: "⚙️ Fast Workers" },
    massprod:   { base: 6000,  growth: 1.8,  label: "🏭 Mass Production", prereq: (c) => c.workers >= 3 },

    // --- Defense research chain: Fortify → Reinforced ---
    fortify:    { base: 450,   growth: 1.75, label: "🛡️ Fortify" },
    reinforced: { base: 5000,  growth: 1.7,  label: "🏰 Reinforced", prereq: (c) => c.fortify >= 2 },
  };
  const TRAINING_STEP = 0.15;
  const OFFICER_STEP = 0.25;
  const WORKERS_STEP = 0.20;
  const FORTIFY_DMG_STEP = 0.18;
  const FORTIFY_HP = 100;

  // Defensive structures: stationary, auto-fire at enemies near your base.
  const DEF = {
    tower: { base: 160, growth: 1.6, range: 135, dmg: 17, fire: 0.65, label: "🗼 Tower" },
  };

  // Military units: fixed cost; spawn one that marches on the enemy outpost.
  // Artillery has splash. Commando is an elite striker unlocked by Elite Corps.
  const MIL = {
    soldier:   { cost: 25,   hp: 60,  dmg: 9,  speed: 46, range: 26, atk: 0.55, bounty: 9,   label: "🪖 Soldier",   color: "#57c6ff", ecolor: "#ff8787" },
    tank:      { cost: 130,  hp: 280, dmg: 30, speed: 26, range: 30, atk: 0.95, bounty: 34,  label: "🚜 Tank",      color: "#69db7c", ecolor: "#ffa94d" },
    heli:      { cost: 320,  hp: 170, dmg: 22, speed: 64, range: 48, atk: 0.5,  bounty: 46,  label: "🚁 Heli",      color: "#ffd43b", ecolor: "#da77f2" },
    artillery: { cost: 750,  hp: 240, dmg: 60, speed: 18, range: 78, atk: 1.5,  bounty: 90,  label: "💥 Artillery", color: "#ffa94d", ecolor: "#ff6b6b", splash: 42 },
    commando:  { cost: 1100, hp: 320, dmg: 70, speed: 70, range: 40, atk: 0.6,  bounty: 120, label: "🥷 Commando",  color: "#b197fc", ecolor: "#ff6b9d", lock: (c) => c.elite < 1 },
  };

  // ---- Game state ---------------------------------------------------------
  let cash, counts, units, particles, towers, tracers, coins;
  let player;                          // the commander avatar you walk around
  let myBase, enemyBase;
  let territory, score, best;
  let enemySpawnT, raidT;
  let goods, marketPrice, marketT;     // swinging-market sell mechanic
  let running = false, gameOver = false;
  let scoreSubmitted = false;
  let lastTime = 0;
  let lastIncomeRate = 0;

  // Movement input: held keyboard keys + a touch virtual joystick.
  const held = new Set();
  const MOVE_KEYS = new Set([
    "w", "a", "s", "d",
    "arrowup", "arrowdown", "arrowleft", "arrowright",
  ]);
  let joyActive = false, joyId = null;
  let joyBaseX = 0, joyBaseY = 0, joyKnobX = 0, joyKnobY = 0;
  let joyVecX = 0, joyVecY = 0;        // -JOY_MAX..JOY_MAX

  // Same-device persistence + idle bonus, resolved on boot.
  let pendingResume = null;
  let pendingIdle = 0;

  const RUN_KEY = "miniwarRun";
  const IDLE_KEY = "miniwarIdle";
  const IDLE_FACTOR = 0.04;            // fraction of income rate banked while away
  const IDLE_CAP_SEC = 8 * 3600;       // bank at most 8h of offline time
  const IDLE_MAX = 250000;             // and never more than this much cash

  best = Number(localStorage.getItem("miniwarBest") || 0);
  bestEl.textContent = best;

  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function econCost(key) {
    const d = ECON[key];
    return Math.floor(d.base * Math.pow(d.growth, counts[key]));
  }

  function econLocked(key) {
    const d = ECON[key];
    return !!(d.prereq && !d.prereq(counts));
  }
  function econCapped(key) {
    const d = ECON[key];
    return !!(d.cap && counts[key] >= d.cap);
  }

  function towerCost() {
    return Math.floor(DEF.tower.base * Math.pow(DEF.tower.growth, towers.length));
  }

  function incomePerSec() {
    const mult = (1 + counts.workshop * 0.25) *
      Math.pow(1.4, counts.powerplant) *
      (1 + counts.workers * WORKERS_STEP) *
      Math.pow(1.5, counts.massprod);
    return (BASE_INCOME + counts.farm * 4 + counts.bank * 24) * mult;
  }

  // Permanent troop-damage multiplier from Army Training + Officer research.
  function unitDmgMult() {
    return 1 + counts.training * TRAINING_STEP + counts.officer * OFFICER_STEP;
  }

  // Tower upgrades from the Fortify → Reinforced research chain.
  function towerDmgMult() { return 1 + counts.fortify * FORTIFY_DMG_STEP; }
  function towerRangeMult() { return 1 + counts.reinforced * 0.12; }
  function towerFireMult() { return Math.pow(0.85, counts.reinforced); }

  // ---- Market (sell goods on a swinging price) ---------------------------
  function goodsPerSec() {
    return 0.5 * (counts.farm + counts.bank * 2 + counts.powerplant * 3 + 1) *
      (1 + counts.workers * 0.1);
  }
  function goodsCap() {
    return 80 + 60 * (counts.farm + counts.bank + counts.powerplant);
  }
  function marketHot() { return marketPrice >= 1.25; }
  function sellGoods() {
    if (goods < 1) return;
    const gain = Math.floor(goods * marketPrice);
    cash += gain;
    goods = 0;
    spawnParticles(80, H / 2, marketHot() ? "#7ee08a" : "#ffd43b", 6);
  }

  function enemyBaseMaxHp() {
    return Math.round(280 + territory * 170);
  }

  function reset() {
    cash = START_CASH;
    counts = {
      farm: 0, workshop: 0, bank: 0, powerplant: 0,
      training: 0, officer: 0, elite: 0,
      workers: 0, massprod: 0,
      fortify: 0, reinforced: 0,
    };
    units = [];
    particles = [];
    towers = [];
    tracers = [];
    coins = [];
    player = { x: W / 2, y: FIELD_BOTTOM - 30, r: PLAYER_R };
    held.clear();
    joyActive = false; joyId = null; joyVecX = 0; joyVecY = 0;
    territory = 0;
    score = 0;
    myBase = { hp: MY_BASE_HP, max: MY_BASE_HP };
    enemyBase = { hp: enemyBaseMaxHp(), max: enemyBaseMaxHp() };
    enemySpawnT = 3.6;
    raidT = 0;
    goods = 0;
    marketT = Math.random() * 12;
    marketPrice = 1;
    gameOver = false;
    scoreEl.textContent = "0";
    territoryEl.textContent = "0";
  }

  // ---- Buying -------------------------------------------------------------
  function buy(key) {
    if (!running || gameOver) return;
    if (key === "collect") { sellGoods(); return; }
    if (ECON[key]) {
      if (econLocked(key) || econCapped(key)) return;
      const c = econCost(key);
      if (cash < c) return;
      cash -= c;
      counts[key]++;
      if (key === "fortify" && myBase) {
        myBase.max += FORTIFY_HP;
        myBase.hp = Math.min(myBase.max, myBase.hp + FORTIFY_HP);
      }
    } else if (DEF[key]) {
      if (towers.length >= MAX_TOWERS) return;
      const c = towerCost();
      if (cash < c) return;
      cash -= c;
      placeTower();
    } else if (MIL[key]) {
      const d = MIL[key];
      if (d.lock && d.lock(counts)) return;
      if (cash < d.cost) return;
      if (countSide("ally") >= MAX_UNITS_PER_SIDE) return;
      cash -= d.cost;
      spawnUnit("ally", key);
    }
  }

  // Place a tower along your base line, spread evenly across the slots.
  function placeTower() {
    const slot = towers.length;
    const x = 60 + ((slot + 0.5) / MAX_TOWERS) * (W - 120);
    towers.push({
      x, y: FIELD_BOTTOM - 34,
      range: DEF.tower.range, dmg: DEF.tower.dmg,
      fireInt: DEF.tower.fire, fireCd: 0,
    });
  }

  function countSide(side) {
    let n = 0;
    for (const u of units) if (u.side === side) n++;
    return n;
  }

  function spawnUnit(side, type) {
    const d = MIL[type];
    const hpScale = side === "enemy" ? 1 + territory * 0.08 : 1;
    const dmgScale = side === "enemy" ? 1 + territory * 0.06 : 1;
    // Allies rally to wherever the commander is standing; enemies pour out
    // randomly along the outpost line.
    const spawnX = side === "ally" && player
      ? clamp(player.x + (Math.random() * 40 - 20), 50, W - 50)
      : 50 + Math.random() * (W - 100);
    units.push({
      side, type,
      x: spawnX,
      y: side === "ally" ? FIELD_BOTTOM - 6 : FIELD_TOP + 6,
      hp: d.hp * hpScale,
      max: d.hp * hpScale,
      dmg: d.dmg * dmgScale,
      speed: d.speed * (0.92 + Math.random() * 0.16),
      range: d.range,
      atkInt: d.atk,
      atkCd: 0,
      r: type === "tank" ? 11 : (type === "heli" || type === "commando") ? 9 : 8,
      color: side === "ally" ? d.color : d.ecolor,
    });
  }

  // ---- Wiring the shop buttons -------------------------------------------
  const shopButtons = Array.from(document.querySelectorAll("[data-buy]"));
  shopButtons.forEach((btn) => {
    const key = btn.getAttribute("data-buy");
    const handler = (e) => { e.preventDefault(); buy(key); };
    btn.addEventListener("click", handler);
  });

  function refreshShop() {
    for (const btn of shopButtons) {
      const key = btn.getAttribute("data-buy");
      const costEl = btn.querySelector(".cost");
      const cntEl = btn.querySelector(".count");

      if (key === "collect") {
        const gain = Math.floor(goods * marketPrice);
        if (costEl) costEl.textContent = "$" + formatNum(gain);
        const hot = marketHot() && running && !gameOver && goods >= 1;
        btn.classList.toggle("hot", hot);
        btn.disabled = !running || gameOver || goods < 1;
        continue;
      }

      if (ECON[key]) {
        const locked = econLocked(key);
        const capped = econCapped(key);
        const cost = econCost(key);
        if (cntEl) cntEl.textContent = counts[key] ? "×" + counts[key] : "";
        btn.classList.toggle("locked", locked && !capped);
        if (costEl) costEl.textContent = capped ? "OWNED" : locked ? "🔒" : "$" + formatNum(cost);
        btn.disabled = !running || gameOver || locked || capped || cash < cost;
      } else if (DEF[key]) {
        const atCap = towers.length >= MAX_TOWERS;
        const cost = towerCost();
        if (cntEl) cntEl.textContent = towers.length ? "×" + towers.length : "";
        if (costEl) costEl.textContent = atCap ? "MAX" : "$" + formatNum(cost);
        btn.disabled = !running || gameOver || atCap || cash < cost;
      } else if (MIL[key]) {
        const d = MIL[key];
        const locked = !!(d.lock && d.lock(counts));
        btn.classList.toggle("locked", locked);
        if (costEl) costEl.textContent = locked ? "🔒" : "$" + formatNum(d.cost);
        btn.disabled = !running || gameOver || locked || cash < d.cost;
      }
    }
  }

  // ---- Controls -----------------------------------------------------------
  function primaryAction() { if (!running) startGame(false); }

  // Keyboard shortcuts mirror the click/tap build menu so PC players can play
  // fast: 1-5 = units, Q/E/R/F = economy, T = tower, G = sell goods.
  // (W/A/S/D + arrows are reserved for moving the commander.)
  const KEY_MAP = {
    "1": "soldier", "2": "tank", "3": "heli", "4": "artillery", "5": "commando",
    q: "farm", e: "workshop", r: "bank", f: "powerplant",
    t: "tower", g: "collect",
  };

  function typingInField() {
    return document.activeElement === nameInput;
  }

  window.addEventListener("keydown", (e) => {
    if (typingInField()) return;
    const k = e.key.toLowerCase();
    if (e.key === " " || e.key === "Enter") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      e.preventDefault();
      primaryAction();
      return;
    }
    if (MOVE_KEYS.has(k)) {
      if (running && !gameOver) { held.add(k); e.preventDefault(); }
      return;
    }
    if (!running || gameOver) return;
    const key = KEY_MAP[k];
    if (key) { e.preventDefault(); buy(key); }
  });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (held.has(k)) held.delete(k);
  });
  // Drop any held movement keys if focus leaves the page (avoid "stuck" walking).
  window.addEventListener("blur", () => held.clear());

  canvas.addEventListener("mousedown", (e) => { e.preventDefault(); primaryAction(); });

  // Convert a client (screen) coordinate into canvas/game coordinates, since
  // the canvas is CSS-scaled to fit its container.
  function toGame(cx, cy) {
    const r = canvas.getBoundingClientRect();
    return {
      x: r.width ? (cx - r.left) / r.width * W : 0,
      y: r.height ? (cy - r.top) / r.height * H : 0,
    };
  }

  // Touch: tap to start, then drag anywhere on the board to steer a virtual
  // joystick that walks the commander around.
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (!running && !gameOver) { startGame(false); return; }
    if (!running || gameOver) return;
    const t = e.changedTouches[0];
    const p = toGame(t.clientX, t.clientY);
    joyActive = true;
    joyId = t.identifier;
    joyBaseX = p.x; joyBaseY = p.y;
    joyKnobX = p.x; joyKnobY = p.y;
    joyVecX = 0; joyVecY = 0;
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    if (!joyActive) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      e.preventDefault();
      const p = toGame(t.clientX, t.clientY);
      let dx = p.x - joyBaseX, dy = p.y - joyBaseY;
      const mag = Math.hypot(dx, dy);
      if (mag > JOY_MAX) { dx = dx / mag * JOY_MAX; dy = dy / mag * JOY_MAX; }
      joyVecX = dx; joyVecY = dy;
      joyKnobX = joyBaseX + dx; joyKnobY = joyBaseY + dy;
    }
  }, { passive: false });

  function endJoystick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyActive = false; joyId = null; joyVecX = 0; joyVecY = 0;
      }
    }
  }
  canvas.addEventListener("touchend", endJoystick, { passive: false });
  canvas.addEventListener("touchcancel", endJoystick, { passive: false });

  startBtn.addEventListener("click", () => startGame(false));

  const isTouch =
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  if (isTouch) document.body.classList.add("touch");

  // fresh=true forces a brand-new run (ignoring any saved game).
  function startGame(fresh) {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    if (!fresh && pendingResume) {
      applyRun(pendingResume);
    } else {
      reset();
      if (pendingIdle > 0) cash += pendingIdle;
    }
    pendingResume = null;
    pendingIdle = 0;
    if (idleNote) idleNote.hidden = true;
    overlay.classList.add("hidden");
    overlayScore.hidden = true;
    submitRow.hidden = true;
    replaceConfirm.hidden = true;
    running = true;
    gameOver = false;
    scoreSubmitted = false;
    lastTime = performance.now();
  }

  // ---- Enemy AI -----------------------------------------------------------
  function enemySpawnInterval() {
    return Math.max(1.0, 3.4 - territory * 0.16);
  }

  function pickEnemyType() {
    const r = Math.random();
    if (territory >= 4 && r < 0.22) return "heli";
    if (territory >= 2 && r < 0.5) return "tank";
    return "soldier";
  }

  // ---- Commander avatar: movement + on-field interactions ----------------
  function updatePlayer(dt) {
    if (!player) return;

    // Gather a movement vector from keyboard (held) and the touch joystick.
    let mx = 0, my = 0;
    if (held.has("a") || held.has("arrowleft")) mx -= 1;
    if (held.has("d") || held.has("arrowright")) mx += 1;
    if (held.has("w") || held.has("arrowup")) my -= 1;
    if (held.has("s") || held.has("arrowdown")) my += 1;
    if (joyActive) { mx += joyVecX / JOY_MAX; my += joyVecY / JOY_MAX; }

    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    if (mag > 0.01) {
      player.x = clamp(player.x + mx * PLAYER_SPEED * dt, PLAYER_MIN_X, PLAYER_MAX_X);
      player.y = clamp(player.y + my * PLAYER_SPEED * dt, PLAYER_MIN_Y, PLAYER_MAX_Y);
    }

    // Lead the assault: standing at the enemy outpost chips its health and can
    // finish a capture even before your troops arrive.
    if (player.y <= ENEMY_ZONE_Y && enemyBase) {
      enemyBase.hp -= ASSAULT_DPS * unitDmgMult() * dt;
      if (Math.random() < dt * 8) spawnParticles(player.x, player.y - 6, "#ffd43b", 1);
      if (enemyBase.hp <= 0) captureTerritory();
    }

    // Hold the line: standing at your own base repairs it over time.
    if (player.y >= BASE_ZONE_Y && myBase && myBase.hp < myBase.max) {
      myBase.hp = Math.min(myBase.max, myBase.hp + REPAIR_PER_SEC * dt);
      if (Math.random() < dt * 6) spawnParticles(player.x, player.y - 6, "#7ee08a", 1);
    }

    // Collect dropped coins by walking over them.
    for (const c of coins) {
      if (c.taken) continue;
      if (Math.hypot(c.x - player.x, c.y - player.y) <= COIN_PICK_R) {
        c.taken = true;
        c.life = 0;
        cash += c.value;
        score += 2;
        scoreEl.textContent = String(score);
        spawnParticles(c.x, c.y, "#ffe066", 6);
      }
    }
  }

  // ---- Update -------------------------------------------------------------
  function update(dt) {
    lastIncomeRate = incomePerSec();
    cash += lastIncomeRate * dt;
    if (raidT > 0) raidT -= dt;

    updatePlayer(dt);

    for (const c of coins) c.life -= dt;
    coins = coins.filter((c) => c.life > 0);

    // Swinging market: price drifts between ~0.35× and ~1.65×; goods build up
    // from your economy and must be manually sold (ideally on a price spike).
    marketT += dt;
    marketPrice = 1 + 0.5 * Math.sin(marketT * 0.45) + 0.16 * Math.sin(marketT * 1.7 + 1.3);
    if (marketPrice < 0.3) marketPrice = 0.3;
    goods = Math.min(goodsCap(), goods + goodsPerSec() * dt);

    // Enemy outpost periodically sends a defender/attacker downfield. During a
    // Raid (triggered every few captures) they pour out much faster.
    enemySpawnT -= dt;
    if (enemySpawnT <= 0 && countSide("enemy") < MAX_UNITS_PER_SIDE) {
      spawnUnit("enemy", pickEnemyType());
      let interval = enemySpawnInterval();
      if (raidT > 0) interval *= 0.45;
      enemySpawnT = interval;
    }

    for (const u of units) {
      u.atkCd -= dt;
      const target = nearestOpponent(u);
      if (target && dist(u, target) <= u.range + target.r) {
        // In range of an enemy unit — stand and fight.
        if (u.atkCd <= 0) {
          u.atkCd = u.atkInt;
          const byAlly = u.side === "ally";
          const out = u.dmg * (byAlly ? unitDmgMult() : 1);
          damageUnit(target, out, byAlly);
          const sp = MIL[u.type].splash;
          if (sp) {
            for (const o of units) {
              if (o.side === u.side || o === target || o.hp <= 0) continue;
              if (dist(o, target) <= sp) damageUnit(o, out * 0.6, byAlly);
            }
            spawnParticles(target.x, target.y, "#ffd43b", 6);
          }
        }
      } else {
        // March toward the opposing base.
        const dir = u.side === "ally" ? -1 : 1;
        const goalY = u.side === "ally" ? FIELD_TOP + 14 : FIELD_BOTTOM - 14;
        const atBase = u.side === "ally" ? u.y <= goalY : u.y >= goalY;
        if (atBase) {
          if (u.atkCd <= 0) {
            const b = u.side === "ally" ? enemyBase : myBase;
            b.hp -= u.dmg * (u.side === "ally" ? unitDmgMult() : 1);
            u.atkCd = u.atkInt;
            spawnParticles(u.x, u.y, u.color, 3);
            if (u.side === "ally" && enemyBase.hp <= 0) captureTerritory();
            if (u.side === "enemy" && myBase.hp <= 0) { myBase.hp = 0; endGame(); return; }
          }
        } else {
          u.y += dir * u.speed * dt;
        }
      }
    }

    // Defensive towers auto-fire at the nearest enemy in range.
    const tRange = DEF.tower.range * towerRangeMult();
    const tRangeSq = tRange * tRange;
    for (const t of towers) {
      t.fireCd -= dt;
      if (t.fireCd > 0) continue;
      let tgt = null, bd = tRangeSq;
      for (const o of units) {
        if (o.side !== "enemy" || o.hp <= 0) continue;
        const d = (o.x - t.x) ** 2 + (o.y - t.y) ** 2;
        if (d < bd) { bd = d; tgt = o; }
      }
      if (tgt) {
        t.fireCd = t.fireInt * towerFireMult();
        damageUnit(tgt, t.dmg * towerDmgMult(), true);
        tracers.push({ x1: t.x, y1: t.y - 18, x2: tgt.x, y2: tgt.y, life: 0.12 });
      }
    }

    units = units.filter((u) => u.hp > 0);

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const tr of tracers) tr.life -= dt;
    tracers = tracers.filter((tr) => tr.life > 0);
  }

  // Apply damage to a unit; credit cash + score if an ally killed an enemy.
  function damageUnit(v, dmg, byAlly) {
    v.hp -= dmg;
    if (v.hp <= 0) {
      v.hp = 0;
      spawnParticles(v.x, v.y, v.color, 7);
      if (v.side === "enemy" && byAlly) {
        cash += MIL[v.type].bounty;
        score += 10;
        scoreEl.textContent = String(score);
        // Sometimes a fallen enemy drops a coin for the commander to grab.
        if (Math.random() < 0.45) {
          coins.push({
            x: clamp(v.x, 20, W - 20),
            y: clamp(v.y, FIELD_TOP + 8, FIELD_BOTTOM - 8),
            value: Math.max(5, Math.round(MIL[v.type].bounty * 0.6)),
            life: COIN_LIFE,
            taken: false,
          });
        }
      }
    }
  }

  function captureTerritory() {
    territory++;
    score += 300;
    scoreEl.textContent = String(score);
    territoryEl.textContent = String(territory);
    // Push the front line back: clear enemy units, heal a little, tougher outpost.
    units = units.filter((u) => u.side === "ally");
    myBase.hp = Math.min(myBase.max, myBase.hp + 120);
    enemyBase.max = enemyBaseMaxHp();
    enemyBase.hp = enemyBase.max;
    enemySpawnT = Math.max(0.8, enemySpawnInterval());
    spawnParticles(W / 2, FIELD_TOP, "#ffd43b", 24);
    // Every 3rd territory the enemy launches a Raid — a fast, heavy counter.
    if (territory % 3 === 0) raidT = 6;
    saveRunToStorage();       // capturing land is a milestone — save it now
  }

  function nearestOpponent(u) {
    let best = null, bd = Infinity;
    for (const o of units) {
      if (o.side === u.side || o.hp <= 0) continue;
      const d = (o.x - u.x) ** 2 + (o.y - u.y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    // Only engage opponents that are reasonably close along the lane.
    if (best && Math.abs(best.y - u.y) > 90) return null;
    return best;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function spawnParticles(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 110;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.3, color });
    }
  }

  // ---- Drawing ------------------------------------------------------------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a1320");      // enemy half (reddish)
    g.addColorStop(0.5, "#11142e");
    g.addColorStop(1, "#0c1f24");      // your half (greenish)
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let y = FIELD_TOP; y <= FIELD_BOTTOM; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Midline.
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawBase(y, b, color, label) {
    const bw = W - 80, bx = 40;
    ctx.fillStyle = color;
    roundRect(bx, y - 16, bw, 28, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    roundRect(bx + 4, y - 13, bw - 8, 7, 3);
    ctx.fill();
    const frac = Math.max(0, b.hp / b.max);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(bx, y - 28, bw, 7);
    ctx.fillStyle = frac > 0.5 ? "#69db7c" : frac > 0.25 ? "#ffd43b" : "#ff6b6b";
    ctx.fillRect(bx, y - 28, bw * frac, 7);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 12px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${label}  ${Math.max(0, Math.ceil(b.hp))}/${b.max}`, W / 2, y - 32);
  }

  function drawUnit(u) {
    ctx.fillStyle = u.color;
    if (u.type === "tank") {
      roundRect(u.x - u.r, u.y - u.r * 0.8, u.r * 2, u.r * 1.6, 3);
      ctx.fill();
    } else if (u.type === "heli") {
      ctx.beginPath();
      ctx.moveTo(u.x, u.y - u.r);
      ctx.lineTo(u.x + u.r, u.y + u.r);
      ctx.lineTo(u.x - u.r, u.y + u.r);
      ctx.closePath();
      ctx.fill();
    } else if (u.type === "commando") {
      // Diamond to read as an elite unit.
      ctx.beginPath();
      ctx.moveTo(u.x, u.y - u.r);
      ctx.lineTo(u.x + u.r, u.y);
      ctx.lineTo(u.x, u.y + u.r);
      ctx.lineTo(u.x - u.r, u.y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (u.hp < u.max) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(u.x - u.r, u.y - u.r - 5, u.r * 2, 3);
      ctx.fillStyle = "#7ee08a";
      ctx.fillRect(u.x - u.r, u.y - u.r - 5, u.r * 2 * Math.max(0, u.hp / u.max), 3);
    }
  }

  function drawTowers() {
    for (const t of towers) {
      ctx.fillStyle = "#8a93b8";
      roundRect(t.x - 8, t.y - 14, 16, 22, 4);
      ctx.fill();
      ctx.fillStyle = "#c8d0ee";
      roundRect(t.x - 5, t.y - 18, 10, 8, 2);
      ctx.fill();
    }
  }

  function drawTracers() {
    ctx.strokeStyle = "rgba(255, 235, 130, 0.85)";
    ctx.lineWidth = 2;
    for (const tr of tracers) {
      ctx.globalAlpha = Math.max(0, tr.life / 0.12);
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCoins() {
    for (const c of coins) {
      const fade = Math.min(1, c.life / 1.2);
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#ffd43b";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7a5a00";
      ctx.font = "bold 8px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", c.x, c.y + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    if (!player) return;
    const p = player;

    // Highlight whichever zone the commander is currently helping.
    if (p.y <= ENEMY_ZONE_Y) {
      ctx.strokeStyle = "rgba(255,107,107,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 9, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.y >= BASE_ZONE_Y) {
      ctx.strokeStyle = "rgba(126,224,138,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Soft shadow.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + p.r * 0.85, p.r * 0.9, p.r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body.
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a86ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r - 3, 0, Math.PI * 2);
    ctx.fill();

    // A little flag/star to read as "your commander".
    ctx.fillStyle = "#ffd43b";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawJoystick() {
    if (!joyActive) return;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joyBaseX, joyBaseY, JOY_MAX, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(124,92,255,0.85)";
    ctx.beginPath();
    ctx.arc(joyKnobX, joyKnobY, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHud() {
    if (!running && !gameOver) return;
    ctx.font = "bold 16px -apple-system, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd43b";
    ctx.fillText(`$${formatNum(Math.floor(cash))}`, 12, H / 2 - 30);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 12px -apple-system, sans-serif";
    ctx.fillText(`+$${formatNum(Math.round(incomePerSec()))}/s`, 12, H / 2 - 12);
    // Market readout: goods on hand @ current price (green when it's hot).
    ctx.fillStyle = marketHot() ? "#7ee08a" : "rgba(255,255,255,0.6)";
    ctx.font = "bold 11px -apple-system, sans-serif";
    ctx.fillText(`📦 ${formatNum(Math.floor(goods))} @ ×${marketPrice.toFixed(2)}`, 12, H / 2 + 4);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 14px -apple-system, sans-serif";
    ctx.fillText(`Territory ${territory}`, W - 12, H / 2 - 24);
    ctx.fillText(`Score ${score}`, W - 12, H / 2 - 6);

    if (raidT > 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "bold 22px -apple-system, sans-serif";
      ctx.fillText("⚠ RAID INCOMING ⚠", W / 2, FIELD_TOP + 22);
    }
  }

  function frame(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (running && !gameOver) update(dt);

    drawBackground();
    drawBase(FIELD_TOP, enemyBase, "#a23b4e", "Enemy Outpost");
    drawBase(FIELD_BOTTOM, myBase, "#2f7d56", "Your Base");
    drawTowers();
    for (const u of units) drawUnit(u);
    drawCoins();
    drawTracers();
    drawParticles();
    drawPlayer();
    drawJoystick();
    drawHud();
    refreshShop();

    requestAnimationFrame(frame);
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem("miniwarBest", String(best));
    }
    clearRunStorage();        // the run is over — don't offer to resume it
    saveIdleSnapshot();       // but do bank offline income from this economy

    overlayTitle.textContent = "Base Lost ⚔️";
    overlayText.textContent =
      `The enemy overran your base after you captured ${territory} territor` +
      (territory === 1 ? "y" : "ies") + ". Rebuild and march again!";
    overlayScore.hidden = false;
    overlayScore.textContent = `Score ${score} · ${territory} captured`;
    startBtn.textContent = "Play Again";

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

  // ===================================================================
  // Same-device save / resume + idle (offline) income
  // ===================================================================
  // Build the run snapshot object used for the per-device localStorage save.
  function buildRunSnapshot() {
    return {
      v: 3, ts: Date.now(),
      cash, counts, territory, score,
      myBase, enemyBase, enemySpawnT, raidT,
      goods, marketT,
      towers: towers.map((t) => ({ x: t.x })),
      player: player ? { x: player.x, y: player.y } : null,
    };
  }

  function saveRunToStorage() {
    if (!running || gameOver) return;
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify(buildRunSnapshot()));
    } catch (e) { /* storage may be full/blocked */ }
  }

  function clearRunStorage() {
    try { localStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ }
  }

  function loadRunFromStorage() {
    try {
      const s = localStorage.getItem(RUN_KEY);
      if (!s) return null;
      const o = JSON.parse(s);
      if (!o || typeof o.cash !== "number" || !o.counts) return null;
      return o;
    } catch (e) { return null; }
  }

  // Restore a saved run. Transient units/particles are intentionally not
  // serialized — the front line simply restarts, while your economy,
  // research, towers, territory and score all carry over.
  function applyRun(o) {
    reset();
    cash = num(o.cash, START_CASH);
    for (const k in counts) {
      if (o.counts && typeof o.counts[k] === "number") counts[k] = o.counts[k];
    }
    territory = num(o.territory, 0);
    score = num(o.score, 0);
    if (o.myBase) myBase = { hp: num(o.myBase.hp, MY_BASE_HP), max: num(o.myBase.max, MY_BASE_HP) };
    if (o.enemyBase) enemyBase = { hp: num(o.enemyBase.hp, enemyBaseMaxHp()), max: num(o.enemyBase.max, enemyBaseMaxHp()) };
    enemySpawnT = num(o.enemySpawnT, 3.6);
    raidT = num(o.raidT, 0);
    goods = num(o.goods, 0);
    marketT = num(o.marketT, 0);
    towers = [];
    if (Array.isArray(o.towers)) {
      for (const t of o.towers) {
        towers.push({
          x: num(t.x, W / 2), y: FIELD_BOTTOM - 34,
          range: DEF.tower.range, dmg: DEF.tower.dmg,
          fireInt: DEF.tower.fire, fireCd: 0,
        });
      }
    }
    if (o.player) {
      player = {
        x: clamp(num(o.player.x, W / 2), PLAYER_MIN_X, PLAYER_MAX_X),
        y: clamp(num(o.player.y, FIELD_BOTTOM - 30), PLAYER_MIN_Y, PLAYER_MAX_Y),
        r: PLAYER_R,
      };
    }
    scoreEl.textContent = String(score);
    territoryEl.textContent = String(territory);
  }

  function fmtDur(s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function saveIdleSnapshot() {
    try {
      const rate = lastIncomeRate || incomePerSec() || 0;
      localStorage.setItem(IDLE_KEY, JSON.stringify({ ts: Date.now(), rate }));
    } catch (e) { /* ignore */ }
  }

  function computeIdleBonus() {
    try {
      const s = localStorage.getItem(IDLE_KEY);
      if (!s) return;
      const o = JSON.parse(s);
      if (!o || typeof o.rate !== "number") return;
      const elapsed = Math.max(0, (Date.now() - (o.ts || 0)) / 1000);
      if (elapsed < 60) return;                 // need at least a minute away
      const capped = Math.min(elapsed, IDLE_CAP_SEC);
      const bonus = Math.min(IDLE_MAX, Math.floor(o.rate * capped * IDLE_FACTOR));
      if (bonus <= 0) return;
      pendingIdle = bonus;
      if (idleNote) {
        idleNote.hidden = false;
        idleNote.textContent =
          `🌙 While you were away (${fmtDur(capped)}) your economy banked ` +
          `$${formatNum(pendingIdle)} — it'll be added to your next run.`;
      }
    } catch (e) { /* ignore */ }
  }

  // Resolve "is there a saved game on this device?" on boot.
  function initSaveAndIdle() {
    const saved = loadRunFromStorage();
    if (saved) {
      pendingResume = saved;
      startBtn.textContent = "Resume Game";
      overlayScore.hidden = false;
      overlayScore.textContent =
        `Saved game on this device — Territory ${num(saved.territory, 0)} · Score ${num(saved.score, 0)}`;
    } else {
      computeIdleBonus();
    }

    // Persist on the way out and whenever the tab is hidden (mobile-friendly).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (running && !gameOver) saveRunToStorage();
        saveIdleSnapshot();
      }
    });
    window.addEventListener("pagehide", () => {
      if (running && !gameOver) saveRunToStorage();
      saveIdleSnapshot();
    });
    window.addEventListener("beforeunload", () => {
      if (running && !gameOver) saveRunToStorage();
      saveIdleSnapshot();
    });
    setInterval(() => { if (running && !gameOver) saveRunToStorage(); }, 3000);
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

  function formatNum(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  }

  // ===================================================================
  // Global leaderboard — HIGHEST score first (ties: earliest submission)
  // ===================================================================
  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function normalizeName(name) { return String(name || "").trim().toLowerCase(); }

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
      if (!prev) { bestByName.set(key, s); return; }
      const cmp = rankCompare(s, prev);
      if (cmp > 0) bestByName.set(key, s);
      else if (cmp === 0 && (Number(s.ts) || 0) < (Number(prev.ts) || 0)) bestByName.set(key, s);
    });
    return Array.from(bestByName.values()).sort((a, b) => rankCompare(b, a));
  }

  function renderLeaderboard(scores) {
    const collapsed = collapseScores(Array.isArray(scores) ? scores : []);
    currentScores = collapsed;
    lbList.innerHTML = "";
    if (!collapsed.length) {
      lbNote.textContent = "No scores yet — be the first! ⚔️";
      lbNote.hidden = false;
      return;
    }
    lbNote.hidden = true;
    collapsed.slice(0, 20).forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      if (highlight && s.name === highlight.name && s.score === highlight.score) li.classList.add("you");
      li.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(s.name)}</span>` +
        `<span class="lb-wave">${Number(s.wave) || 0}</span>` +
        `<span class="lb-score">${Number(s.score) || 0}</span>`;
      lbList.appendChild(li);
    });
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/miniwar/leaderboard", { cache: "no-store" });
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
  function runIsHigher(run, prev) { return (Number(run.score) || 0) > (Number(prev.score) || 0); }

  function showNameTaken() {
    replaceConfirm.hidden = true;
    submitRow.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit score";
    submitStatus.textContent = "🚫 That name is already taken — please choose a different one.";
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
      if (prevEntry) { showReplaceConfirm(name, prevEntry); return; }
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
    const payload = { name, score, wave: territory, replace };
    try {
      const res = await fetch("/api/miniwar/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) { showNameTaken(); await fetchLeaderboard(); return; }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      scoreSubmitted = true;
      localStorage.setItem("zooSnakeName", name);
      highlight = { name, score };
      renderLeaderboard(Array.isArray(data.scores) ? data.scores : []);
      submitStatus.textContent = replace ? "Updated your score! 🏆" : "Saved to the global board! 🏆";
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
    if (e.key === "Enter") { e.preventDefault(); if (!scoreSubmitted) handleSubmitClick(); }
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
    if (typeof n !== "number" || !isFinite(n)) { visitsCountEl.textContent = "—"; return; }
    visitsCountEl.textContent = Math.max(0, Math.floor(n)).toLocaleString("en-US");
  }

  async function initVisits() {
    const VISIT_KEY = "miniwarCounted";
    const firstOnThisDevice = !localStorage.getItem(VISIT_KEY);
    try {
      const res = await fetch(firstOnThisDevice ? "/api/miniwar/visit" : "/api/miniwar/visits", {
        method: firstOnThisDevice ? "POST" : "GET",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (firstOnThisDevice) localStorage.setItem(VISIT_KEY, "1");
      showVisits(Number(data.visits));
    } catch (err) { showVisits(NaN); }
  }

  async function refreshVisits() {
    try {
      const res = await fetch("/api/miniwar/visits", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      showVisits(Number(data.visits));
    } catch (err) { /* keep */ }
  }

  // ---- Boot ---------------------------------------------------------------
  fitCanvas();
  reset();
  running = false;
  gameOver = false;

  initSaveAndIdle();
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000);
  initVisits();
  setInterval(refreshVisits, 30000);
  requestAnimationFrame(frame);
})();
