// ═══════════════════════════════════════════════════════
//  TRON LIGHT CYCLES  —  game.js
//  Handles: game loop, AI, physics, particles, input
// ═══════════════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ── GRID CONFIG ───────────────────────────────
const CELL = 8;
const COLS = 100;
const ROWS = 75;
canvas.width  = COLS * CELL;   // 800px logical
canvas.height = ROWS * CELL;   // 600px logical

// ── DIFFICULTY PROFILES ───────────────────────
// lookahead  : BFS depth when scoring open space
// mistakeRate: chance AI picks a suboptimal move
// randomTurn : chance AI makes an unprompted swerve
// speedBase  : starting ms per step (lower = faster)
// speedMin   : speed cap (fastest allowed)
const DIFF = {
  easy:   { lookahead: 6,  mistakeRate: 0.40, randomTurn: 0.12, speedBase: 110, speedMin: 60 },
  normal: { lookahead: 12, mistakeRate: 0.18, randomTurn: 0.06, speedBase: 80,  speedMin: 35 },
  hard:   { lookahead: 22, mistakeRate: 0.04, randomTurn: 0.02, speedBase: 65,  speedMin: 22 },
};

let difficulty = 'normal';
let prof       = DIFF['normal'];

// ── COLORS ────────────────────────────────────
const COLORS = {
  player: { head: '#00f5ff', trail: '#007a8a', glow: '#00f5ff' },
  ai: [
    { head: '#ff6a00', trail: '#7a3300', glow: '#ff6a00' },
    { head: '#bf00ff', trail: '#5a0078', glow: '#bf00ff' },
    { head: '#00ff88', trail: '#007a40', glow: '#00ff88' },
  ]
};

// ── DIRECTION CONSTANTS ───────────────────────
const DIR = {
  UP:    { x: 0,  y: -1 },
  DOWN:  { x: 0,  y:  1 },
  LEFT:  { x: -1, y:  0 },
  RIGHT: { x: 1,  y:  0 },
};
const ALL_DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const OPPOSITE = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
const PERP     = {
  UP:    ['LEFT', 'RIGHT'],
  DOWN:  ['RIGHT', 'LEFT'],
  LEFT:  ['DOWN', 'UP'],
  RIGHT: ['UP', 'DOWN'],
};

// ── GAME STATE ────────────────────────────────
let grid        = new Uint8Array(COLS * ROWS);
let player      = null;
let aiCycles    = [];
let particles   = [];
let gameRunning = false;
let gameOver    = false;
let lastTime    = 0;
let stepInterval  = 80;
let timeSinceStep = 0;
let gameAge       = 0;
let score         = 0;

// ════════════════════════════════════════════
//  DIFFICULTY UI
// ════════════════════════════════════════════

function selectDiff(d) {
  difficulty = d;
  prof = DIFF[d];
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector('.diff-btn.' + d).classList.add('selected');
}

// ════════════════════════════════════════════
//  CYCLE FACTORY
// ════════════════════════════════════════════

function makeCycle(x, y, dirName, color, isPlayer) {
  return { x, y, dir: DIR[dirName], dirName, color, alive: true, isPlayer };
}

// ════════════════════════════════════════════
//  GRID HELPERS
// ════════════════════════════════════════════

function markGrid(x, y, id) {
  grid[y * COLS + x] = id;
}

function getCell(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return -1; // wall
  return grid[y * COLS + x];
}

function isFree(x, y) {
  return getCell(x, y) === 0;
}

// ════════════════════════════════════════════
//  FLOOD FILL — open space scorer
//  BFS up to `depth` steps; returns reachable cell count.
//  AI uses this to prefer moves into large open areas.
// ════════════════════════════════════════════

function floodCount(sx, sy, depth) {
  if (depth <= 0) return 0;

  const vis   = new Uint8Array(COLS * ROWS);
  const queue = [];  // flat array: [x, y, depth, ...]
  let   head  = 0;

  vis[sy * COLS + sx] = 1;
  queue.push(sx, sy, 0);

  let count = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    const cd = queue[head++];
    count++;
    if (cd >= depth) continue;

    for (let i = 0; i < 4; i++) {
      const dn = ALL_DIRS[i];
      const nx = cx + DIR[dn].x;
      const ny = cy + DIR[dn].y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const idx = ny * COLS + nx;
      if (vis[idx] || grid[idx]) continue;
      vis[idx] = 1;
      queue.push(nx, ny, cd + 1);
    }
  }
  return count;
}

// ════════════════════════════════════════════
//  START GAME
// ════════════════════════════════════════════

function startGame() {
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('diff-label').textContent = difficulty.toUpperCase();

  // Reset state
  grid          = new Uint8Array(COLS * ROWS);
  particles     = [];
  stepInterval  = prof.speedBase;
  timeSinceStep = 0;
  gameAge       = 0;
  score         = 0;
  gameOver      = false;

  // Spawn player — left-center, heading right
  player = makeCycle(8, Math.floor(ROWS / 2), 'RIGHT', COLORS.player, true);
  markGrid(player.x, player.y, 1);

  // Spawn 3 AI opponents — right side, heading left
  const starts = [
    { x: COLS - 8, y: Math.floor(ROWS * 0.25), dir: 'LEFT' },
    { x: COLS - 8, y: Math.floor(ROWS * 0.50), dir: 'LEFT' },
    { x: COLS - 8, y: Math.floor(ROWS * 0.75), dir: 'LEFT' },
  ];
  aiCycles = starts.map((s, i) => {
    const ai = makeCycle(s.x, s.y, s.dir, COLORS.ai[i], false);
    markGrid(ai.x, ai.y, i + 2);
    return ai;
  });

  updateHUD();
  gameRunning = true;
  lastTime    = performance.now();
  requestAnimationFrame(gameLoop);
}

// ════════════════════════════════════════════
//  GAME LOOP
// ════════════════════════════════════════════

function gameLoop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  if (gameRunning) {
    timeSinceStep += dt;
    gameAge       += dt;

    // Gradually increase speed over time
    const range  = prof.speedBase - prof.speedMin;
    stepInterval = Math.max(
      prof.speedMin,
      prof.speedBase - Math.floor(gameAge / 1000) * (range / 30)
    );
    updateSpeedBar();

    if (timeSinceStep >= stepInterval) {
      timeSinceStep = 0;
      tick();
    }
  }

  updateParticles(dt);
  render();

  // Keep RAF alive while particles are still animating after death
  if (gameRunning || particles.length > 0) requestAnimationFrame(gameLoop);
}

// ════════════════════════════════════════════
//  TICK — one logical game step
// ════════════════════════════════════════════

function tick() {
  if (gameOver) return;
  score++;
  updateHUD();

  // ── Move player ──────────────────────────
  if (player.alive) {
    const nx = player.x + player.dir.x;
    const ny = player.y + player.dir.y;

    if (!isFree(nx, ny)) {
      player.alive = false;
      spawnExplosion(player.x * CELL + CELL / 2, player.y * CELL + CELL / 2, player.color.head, 65);
      endGame(false);
      return;
    }
    player.x = nx;
    player.y = ny;
    markGrid(nx, ny, 1);
  }

  // ── Move AI cycles ───────────────────────
  let alive = 0;
  for (let i = 0; i < aiCycles.length; i++) {
    const ai = aiCycles[i];
    if (!ai.alive) continue;
    alive++;

    thinkAI(ai);

    const nx = ai.x + ai.dir.x;
    const ny = ai.y + ai.dir.y;

    if (!isFree(nx, ny)) {
      ai.alive = false;
      spawnExplosion(ai.x * CELL + CELL / 2, ai.y * CELL + CELL / 2, ai.color.head, 50);
      continue;
    }
    ai.x = nx;
    ai.y = ny;
    markGrid(nx, ny, i + 2);
  }

  if (alive === 0 && player.alive) endGame(true);
}

// ════════════════════════════════════════════
//  AI BRAIN
//  Scores every valid move by BFS open-space count.
//  Higher difficulty = deeper lookahead, fewer mistakes.
// ════════════════════════════════════════════

function thinkAI(ai) {
  // Candidate moves: ahead, perpendicular left, perpendicular right
  const candidates = [ai.dirName, ...PERP[ai.dirName]];

  const scored = [];
  for (const dn of candidates) {
    const nx = ai.x + DIR[dn].x;
    const ny = ai.y + DIR[dn].y;
    if (!isFree(nx, ny)) continue; // blocked — skip
    scored.push({ dn, space: floodCount(nx, ny, prof.lookahead) });
  }

  if (scored.length === 0) return; // totally boxed in — nothing to do

  // Sort best (most open space) first
  scored.sort((a, b) => b.space - a.space);

  let pick;
  if (Math.random() < prof.mistakeRate && scored.length > 1) {
    // Intentional mistake: pick suboptimal move
    pick = scored[1 + Math.floor(Math.random() * (scored.length - 1))];
  } else {
    pick = scored[0];
  }

  // Occasional unprompted swerve — prevents overly robotic straight-line movement
  if (pick.dn === ai.dirName && Math.random() < prof.randomTurn) {
    const alt = scored.find(s => s.dn !== ai.dirName);
    if (alt) pick = alt;
  }

  ai.dir     = DIR[pick.dn];
  ai.dirName = pick.dn;
}

// ════════════════════════════════════════════
//  PARTICLES — explosion on crash
// ════════════════════════════════════════════

function spawnExplosion(cx, cy, color, n) {
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 1.5 + Math.random() * 5.5;
    particles.push({
      x:     cx,
      y:     cy,
      vx:    Math.cos(angle) * spd,
      vy:    Math.sin(angle) * spd,
      life:  1.0,
      decay: 0.016 + Math.random() * 0.028,
      size:  2 + Math.random() * 3.5,
      color,
    });
  }
}

function updateParticles(dt) {
  const f = dt / 16; // normalise to ~60 fps
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x    += p.vx * f;
    p.y    += p.vy * f;
    p.vy   += 0.09 * f;     // subtle gravity
    p.life -= p.decay * f;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ════════════════════════════════════════════
//  END GAME
// ════════════════════════════════════════════

function endGame(won) {
  gameOver    = true;
  gameRunning = false;

  setTimeout(() => {
    const titleEl = document.getElementById('overlay-title');
    const subEl   = document.getElementById('overlay-subtitle');

    document.getElementById('restart-btn').textContent = 'REBOOT';

    if (won) {
      titleEl.textContent      = 'VICTORY';
      titleEl.style.color      = 'var(--cyan)';
      titleEl.style.textShadow = 'var(--glow-cyan)';
    } else {
      titleEl.textContent      = 'DEREZZED';
      titleEl.style.color      = 'var(--orange)';
      titleEl.style.textShadow = 'var(--glow-orange)';
    }

    subEl.textContent = `SCORE: ${String(score).padStart(6, '0')}${won ? '' : ' — END OF LINE'}`;
    document.getElementById('overlay').classList.remove('hidden');
  }, 950);
}

// ════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════

function render() {
  // Background
  ctx.fillStyle = '#020810';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,245,255,0.035)';
  ctx.lineWidth   = 0.5;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(canvas.width, y * CELL);
    ctx.stroke();
  }

  // Trails — read from grid, map id → color
  const colorMap = [null, COLORS.player, ...COLORS.ai];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const id = grid[y * COLS + x];
      if (!id) continue;
      ctx.fillStyle = (colorMap[id] || COLORS.ai[0]).trail;
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  // Cycle heads
  if (player && player.alive) drawHead(player);
  for (const ai of aiCycles) if (ai.alive) drawHead(ai);

  // Particles (topmost layer)
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

function drawHead(cycle) {
  const px = cycle.x * CELL;
  const py = cycle.y * CELL;

  ctx.shadowColor = cycle.color.glow;
  ctx.shadowBlur  = 20;
  ctx.fillStyle   = cycle.color.head;
  ctx.fillRect(px, py, CELL, CELL);

  ctx.shadowBlur  = 6;
  ctx.fillStyle   = '#ffffff';
  ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
  ctx.shadowBlur  = 0;
}

// ════════════════════════════════════════════
//  HUD
// ════════════════════════════════════════════

function updateHUD() {
  document.getElementById('score').textContent    = String(score).padStart(3, '0');
  document.getElementById('ai-count').textContent = aiCycles.filter(a => a.alive).length;
}

function updateSpeedBar() {
  const range = prof.speedBase - prof.speedMin;
  const pct   = ((prof.speedBase - stepInterval) / range) * 100;
  document.getElementById('speed-fill').style.width = Math.max(4, pct) + '%';
}

// ════════════════════════════════════════════
//  KEYBOARD INPUT
// ════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (!gameRunning || !player || !player.alive) return;

  const map = {
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
    w: 'UP', W: 'UP', s: 'DOWN', S: 'DOWN',
    a: 'LEFT', A: 'LEFT', d: 'RIGHT', D: 'RIGHT',
  };

  const req = map[e.key];
  if (req && OPPOSITE[req] !== player.dirName) {
    player.dir     = DIR[req];
    player.dirName = req;
    e.preventDefault();
  }
});

// ════════════════════════════════════════════
//  D-PAD INPUT (touch + mouse)
// ════════════════════════════════════════════

function dpadPress(dirName, e) {
  e.preventDefault();

  // Visual press feedback
  const idMap = { UP: 'btn-up', DOWN: 'btn-down', LEFT: 'btn-left', RIGHT: 'btn-right' };
  document.getElementById(idMap[dirName])?.classList.add('pressed');

  if (!gameRunning || !player || !player.alive) return;
  if (OPPOSITE[dirName] !== player.dirName) {
    player.dir     = DIR[dirName];
    player.dirName = dirName;
  }
}

function dpadRelease(btnId, e) {
  e.preventDefault();
  document.getElementById('btn-' + btnId)?.classList.remove('pressed');
}

// ════════════════════════════════════════════
//  INITIAL CANVAS PAINT (before game starts)
// ════════════════════════════════════════════

(function initCanvas() {
  ctx.fillStyle = '#020810';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(0,245,255,0.035)';
  ctx.lineWidth   = 0.5;

  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(canvas.width, y * CELL);
    ctx.stroke();
  }
})();