// snake.js
'use strict';

/* =========================
   Ustawienia i stałe
   ========================= */
const TILE = 20;              // rozmiar komórki (px)
const START_LEN = 3;          // startowa długość węża
const SPEED_START_MS = 120;   // początkowy interwał logiki
const SPEED_MIN_MS = 70;      // minimalny interwał (max prędkość)
const SPEED_STEP_MS = 10;     // o ile przyspieszać co +5 pkt
const STORAGE_KEY = 'snake.scores';

function fitCanvasDPR(canvas){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// przykład użycia:
const canvas = document.getElementById('gameCanvas');
const ctx = fitCanvasDPR(canvas);
window.addEventListener('resize', ()=>fitCanvasDPR(canvas));

// ---- Audio (WebAudio) ----
const audio = { ctx: null, muted: false };

function initAudio() {
  if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
}

function beep({ freq = 440, dur = 0.1, type = 'sine', gain = 0.05 } = {}) {
  if (audio.muted || !audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.ctx.destination);
  o.start(t);
  o.stop(t + dur);
}

const sEat   = () => beep({ freq: 880, dur: 0.09, type: 'square',   gain: 0.07 });
const sOver  = () => beep({ freq: 140, dur: 0.35, type: 'sawtooth', gain: 0.06 });
const sTick  = () => beep({ freq: 600, dur: 0.07, type: 'triangle', gain: 0.05 });
const sStart = () => beep({ freq: 980, dur: 0.12, type: 'square',   gain: 0.07 });

// Countdown helpers
function startCountdown() {
  state = 'countdown';
  const now = performance.now();
  countdown = { end: now + COUNTDOWN_SEC * 1000, lastInt: null };
}

function countdownRemaining(msNow) {
  if (!countdown) return 0;
  return Math.max(0, countdown.end - msNow);
}

// --- Assets ---
const IMAGES = {};
const ASSETS = {
  head: 'snake_head.png',
  body: 'snake_body.png',
  tail: 'snake_tail.png',     // opcjonalny
  apple: 'apple.png',
  tile: 'tile_dark.png',      // opcjonalny
  bg: 'bg_canvas.png',        // opcjonalny
  logo: 'logo_snake_darkelf.png' // do menu
};

function loadImage(key, src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { IMAGES[key] = img; resolve(); };
    img.src = src;
  });
}

async function loadAssets() {
  const entries = Object.entries(ASSETS).filter(([_, src]) => !!src);
  await Promise.all(entries.map(([k, src]) => loadImage(k, src)));
  // pixel-art: bez wygładzania
  ctx.imageSmoothingEnabled = false;
}

// Twoje pliki head/tail patrzą DOMYŚLNIE W DÓŁ (dy=+1).
// Żeby "down" było rysowane bez obrotu, dajemy -90° (–π/2) kompensacji.
const SPRITE_ANGLE_OFFSET = {
  head: -Math.PI / 2,
  tail: -Math.PI / 2,
  body: 0
};

// Helpery: konwersja wektora kierunku do kąta (radiany) i rysowanie obróconego sprite'a
// kierunek -> kąt w radianach (0 = w prawo)
function dirToAngle(dx, dy) {
  if (dx === 1 && dy === 0) return 0;
  if (dx === -1 && dy === 0) return Math.PI;
  if (dx === 0 && dy === -1) return -Math.PI / 2;
  if (dx === 0 && dy === 1) return Math.PI / 2;
  return 0;
}

// rysowanie obróconego sprite'a względem środka kratki
function drawRotated(img, gridX, gridY, angle, offset = 0) {
  const cx = gridX * TILE + TILE / 2;
  const cy = gridY * TILE + TILE / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle + offset);
  ctx.drawImage(img, -TILE / 2, -TILE / 2, TILE, TILE);
  ctx.restore();
}

// Siatka (w komórkach)
const COLS = canvas.width / TILE;   // 400/20 = 20
const ROWS = canvas.height / TILE;  // 20

/* =========================
   Stan gry
   ========================= */
// + nowy stan odliczania
// 'menu' | 'sp' (opc.) | 'countdown' | 'running' | 'paused' | 'over' | 'scores' | 'help'
let state = 'menu';

const COUNTDOWN_SEC = 3;
let countdown = null; // { end:number(ms), lastInt:number|null }

// Kierunek aktualny i bufor zmiany kierunku (aplikowany na początku update)
let dx = 1, dy = 0;           // start: w prawo
let nextDx = null, nextDy = null;

let snake = [];               // tablica segmentów {x,y}, [0] = głowa
let food = null;              // {x,y}
let score = 0;                // wynik

function updateHUD(level, score){
  const L = document.getElementById('hud-level');
  const S = document.getElementById('hud-score');
  if(L) L.textContent = `Poziom ${level}`;
  if(S) S.textContent = `Wynik ${score}`;
}
// wywołuj po zebraniu jabłka / zmianie poziomu

let currentSpeed = SPEED_START_MS;
let updateTimer = null;
let rafId = null;

// UI (menu)
let showInstructions = false;

// --- Tryby menu ---
let menuMode = 'main'; // 'main' | 'sp' | 'mp'
let menuIndex = 0;
// --- Pauza: menu w trakcie gry ---
let pausedMenuIndex = 0;

// wspólna lista „klikanych” przycisków dla MENU i PAUSE
let lastMenuButtons = []; // [{x,y,w,h,onClick,label}]

// --- Mapy (prosty config) ---
let currentMap = null;
let wrapWalls = false;
let obstacles = []; // tablica bloków {x,y}

const MAPS = [
  { key: 'classic', name: 'Classic', wrap: false, obstacles: () => [] },
  { key: 'box',     name: 'Box',     wrap: false, obstacles: innerBoxObstacles },
  { key: 'wrap',    name: 'Wrap',    wrap: true,  obstacles: () => [] },
];

// generator: prostokąt wewnątrz planszy
function innerBoxObstacles() {
  const m = 3; // margines od krawędzi
  const obs = [];
  for (let x = m; x < COLS - m; x++) {
    obs.push({ x, y: m });
    obs.push({ x, y: ROWS - m - 1 });
  }
  for (let y = m; y < ROWS - m; y++) {
    obs.push({ x: m, y });
    obs.push({ x: COLS - m - 1, y });
  }
  return obs;
}

function applyMap(map) {
  currentMap = map;
  wrapWalls = !!map.wrap;
  obstacles = map.obstacles();
}

// Menu helpers (action-based)
function getMenuOptions() {
  if (menuMode === 'main') {
    return [
      { label: 'Single Player', action: () => { menuMode = 'sp'; menuIndex = 0; } },
      { label: 'Multiplayer (wkrótce)', action: () => { menuMode = 'mp'; menuIndex = 0; } },
      { label: 'Wyniki', action: () => { state = 'scores'; } },
  { label: 'Sterowanie', action: () => { state = 'help'; } },
      { label: 'Start', action: () => { resetGame(); initAudio(); audio.ctx?.resume?.(); startCountdown(); } }
    ];
  }
  if (menuMode === 'sp') {
    return MAPS.map((m, i) => ({
      label: `Mapa: ${m.name}${m.wrap ? ' (wrap)' : ''}`,
      action: () => {
        resetGame(m);
        initAudio?.(); audio.ctx?.resume?.();
        startCountdown(); // wchodzimy w countdown zamiast od razu biec
      }
    })).concat([
      { label: '← Wróć', action: () => { menuMode = 'main'; menuIndex = 0; } }
    ]);
  }
  if (menuMode === 'mp') {
    return [
      { label: 'Tryb w przygotowaniu…', action: null },
      { label: '← Wróć', action: () => { menuMode = 'main'; menuIndex = 0; } }
    ];
  }
  return [];
}

function handleMenuSelect() {
  const opts = getMenuOptions();
  const opt = opts[menuIndex];
  if (opt && opt.action) opt.action();
}

// Pause menu helpers
function getPauseMenuOptions() {
  return [
    { label: '▶ Wznów', action: () => { state = 'running'; } },
    { label: '↻ Restart', action: () => {
        resetGame(currentMap || MAPS?.[0] || { key:'classic', name:'Classic', wrap:false, obstacles:()=>[] });
        startCountdown?.(); // jeśli używasz countdownu – fajny polish
      }
    },
    { label: '⤷ Wybór mapy', action: () => { state = 'menu'; menuMode = 'sp'; menuIndex = 0; } },
    { label: '⌂ Menu główne', action: () => { state = 'menu'; menuMode = 'main'; menuIndex = 0; } },
  { label: () => (audio.muted ? '🔇 OFF (M)' : '🔊 ON (M)'), action: () => { audio.muted = !audio.muted; } },
  ];
}

function handlePauseMenuSelect() {
  const opts = getPauseMenuOptions();
  const opt = opts[pausedMenuIndex];
  if (!opt) return;
  const doAction = typeof opt.label === 'function' ? opt.action : opt.action;
  if (doAction) doAction();
}

/* =========================
   Inicjalizacja / Restart
   ========================= */
function initSnake() {
  const cx = Math.floor(COLS / 2);
  const cy = Math.floor(ROWS / 2);
  // 3 segmenty, skierowane w prawo
  snake = [
    { x: cx,     y: cy },     // głowa
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy }
  ];
}

function resetGame(map = currentMap || MAPS[0]) {
  applyMap(map);
  state = 'running'; // uwaga: i tak wystartujemy z countdown
  score = 0;
  currentSpeed = SPEED_START_MS;

  dx = 1; dy = 0;
  nextDx = null; nextDy = null;

  initSnake();
  food = spawnFood();

  restartUpdateLoop();
}

function restartUpdateLoop() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(update, currentSpeed);
}

/* =========================
   Wejście — klawiatura
   ========================= */
function isOpposite(nx, ny, cx, cy) {
  // przeciwny kierunek jeśli suma składowych == 0
  return nx + cx === 0 && ny + cy === 0;
}

window.addEventListener('keydown', (e) => {
  const k = e.key;

  // Blokuj scroll dla strzałek
  if (k.startsWith('Arrow')) e.preventDefault();

  // --- Obsługa według stanu ---
  if (state === 'menu') {
    // ignore ESC in main menu (no-op)
    if (k === 'Escape') { return; }
    // nawigacja góra/dół
    if (k === 'ArrowUp')   { menuIndex = Math.max(0, menuIndex - 1); return; }
    if (k === 'ArrowDown') { menuIndex = Math.min(getMenuOptions().length - 1, menuIndex + 1); return; }

    // wybór
    if (k === 'Enter' || k === ' ') {
      handleMenuSelect();
      return;
    }

    // S/I nadal mogą działać jak wcześniej, jeśli chcesz
    if (k === 's' || k === 'S') { state = 'scores'; return; }
    if (k === 'i' || k === 'I') { showInstructions = !showInstructions; return; }
    return;
  }

  if (state === 'scores') {
    if (k === 'Escape' || k === 'Enter') {
      state = 'menu';
    }
    return;
  }

  // Help screen: back to menu with ESC / Enter / Space
  if (state === 'help') {
    if (k === 'Escape' || k === 'Enter' || k === ' ') {
      state = 'menu';
    }
    return;
  }

  // ======= TU: obsługa PAUZY =======
  if (state === 'paused') {
    // quick resume
    if (k === 'Escape' || k === 'p' || k === 'P') { state = 'running'; return; }
    if (k === 'ArrowUp')   { pausedMenuIndex = Math.max(0, pausedMenuIndex - 1); return; }
    if (k === 'ArrowDown') { pausedMenuIndex = Math.min(getPauseMenuOptions().length - 1, pausedMenuIndex + 1); return; }
    if (k === 'Enter' || k === ' ') { handlePauseMenuSelect(); return; }
    if (k === 'm' || k === 'M') { audio.muted = !audio.muted; return; }
    return;
  }

  // Sterowanie kierunkiem (buffer nextDx/nextDy, blokada zawracania)
  if (k === 'ArrowUp')    { if (!isOpposite(0, -1, dx, dy)) { nextDx = 0; nextDy = -1; } }
  else if (k === 'ArrowDown') { if (!isOpposite(0, 1, dx, dy))  { nextDx = 0; nextDy = 1; } }
  else if (k === 'ArrowLeft') { if (!isOpposite(-1, 0, dx, dy)) { nextDx = -1; nextDy = 0; } }
  else if (k === 'ArrowRight'){ if (!isOpposite(1, 0, dx, dy))  { nextDx = 1; nextDy = 0; } }

  // Pauza: P — toggle (działa tylko w trakcie gry)
  if (k === 'p' || k === 'P') {
    if (state === 'running') {
      pausedMenuIndex = 0;
      state = 'paused';
    } else if (state === 'paused') {
      state = 'running';
    }
  }

  // ESC podczas gry również wchodzi do pauzy
  if (k === 'Escape') {
    if (state === 'running' || state === 'countdown') {
      pausedMenuIndex = 0;
      state = 'paused';
      return;
    }
  }

  // Restart: Space / Enter tylko gdy 'over'
  if ((k === ' ' || k === 'Enter') && state === 'over') {
    resetGame();
  }

  // Mute: M — włącz/wyłącz dźwięk
  if (k === 'm' || k === 'M') {
    audio.muted = !audio.muted;
  }
}, { passive: false });

// (removed old coarse click handler) use precise hit-testing via lastMenuButtons instead

/* =========================
   Logika gry (stały krok)
   ========================= */
function applyBufferedDirection() {
  if (nextDx === null || nextDy === null) return;
  // Dodatkowe zabezpieczenie przed zawracaniem względem *aktualnego* dx/dy
  if (!isOpposite(nextDx, nextDy, dx, dy)) {
    dx = nextDx;
    dy = nextDy;
  }
  nextDx = null;
  nextDy = null;
}

function update() {
  // W pauzie, menu, wynikach i po game over nie aktualizujemy stanu gry
  if (state !== 'running') return;

  // 1) Zastosuj bufor kierunku
  applyBufferedDirection();

  // 2) Ruch: nowa głowa
  const head = snake[0];
  const newHead = { x: head.x + dx, y: head.y + dy };

  // 3) Dodaj głowę
  snake.unshift(newHead);

  // If wrapping is enabled, wrap the newly added head position
  let nhx = newHead.x, nhy = newHead.y;
  if (wrapWalls) {
    if (nhx < 0) nhx = COLS - 1;
    if (nhx >= COLS) nhx = 0;
    if (nhy < 0) nhy = ROWS - 1;
    if (nhy >= ROWS) nhy = 0;
  }
  const headAfter = { x: nhx, y: nhy };
  // replace the just-added head with the possibly wrapped position
  snake[0] = headAfter;

  // 4) Jedzenie: jeśli trafił -> rośnij (nie zdejmuj ogona), score++, spawnFood()
  let ate = (headAfter.x === food.x && headAfter.y === food.y);
  if (ate) {
    sEat();
    score += 1;
    maybeIncreaseSpeed(); // opcjonalne przyspieszenie
    food = spawnFood();
  } else {
    // 5) Jeśli nie zjadł, zdejmij ogon
    snake.pop();
  }

  // 6) Kolizje: ściany i ciało
  if ((!wrapWalls && hitsWall(headAfter)) || hitsBody(headAfter) || hitsObstacle(headAfter)) {
    state = 'over';
    sOver();
    // prosty zapis wyniku
    setTimeout(() => {
      const defaultName = localStorage.getItem('snake.nick') || 'Anon';
      const name = prompt('Podaj nick do tabeli wyników:', defaultName);
      if (name) localStorage.setItem('snake.nick', name);
      saveScore(name || defaultName, score);
      state = 'scores';
    }, 50);
  }
}

function hitsWall({ x, y }) {
  return x < 0 || y < 0 || x >= COLS || y >= ROWS;
}

function hitsObstacle(head) {
  for (const o of obstacles) if (o.x === head.x && o.y === head.y) return true;
  return false;
}

function hitsBody(head) {
  // sprawdzamy od indeksu 1 (bo [0] to właśnie dodana głowa)
  for (let i = 1; i < snake.length; i++) {
    const s = snake[i];
    if (s.x === head.x && s.y === head.y) return true;
  }
  return false;
}

function maybeIncreaseSpeed() {
  // Przyspiesz co każde +5 punktów, do minimum.
  if (score % 5 === 0 && currentSpeed > SPEED_MIN_MS) {
    currentSpeed = Math.max(SPEED_MIN_MS, currentSpeed - SPEED_STEP_MS);
    restartUpdateLoop();
  }
}

/* =========================
   Rysowanie — wspólne
   ========================= */
function clear() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawGridBg() {
  if (IMAGES.bg) {
    ctx.drawImage(IMAGES.bg, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#12161f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (IMAGES.tile) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.drawImage(IMAGES.tile, x * TILE, y * TILE, TILE, TILE);
      }
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if ((x + y) % 2 === 0) {
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }
}

function drawSnake() {
  for (let i = 0; i < snake.length; i++) {
    const seg = snake[i];

    // HEAD
    if (i === 0 && IMAGES.head) {
      const angle = dirToAngle(dx, dy);
      drawRotated(IMAGES.head, seg.x, seg.y, angle, SPRITE_ANGLE_OFFSET.head);
      continue;
    }

  // TAIL — kierunek od przedostatniego do ogona
    if (i === snake.length - 1 && IMAGES.tail) {
      const prev = snake[i - 1] || seg;
      const tdx = Math.sign(seg.x - prev.x);
      const tdy = Math.sign(seg.y - prev.y);
      const angle = dirToAngle(tdx, tdy);
      drawRotated(IMAGES.tail, seg.x, seg.y, angle, SPRITE_ANGLE_OFFSET.tail);
      continue;
    }

    // BODY — poziomo/pionowo
    if (IMAGES.body) {
      const prev = snake[i - 1] || seg;
      const next = snake[i + 1] || seg;
      const horizontal = (prev.y === seg.y) || (next.y === seg.y);
      const angle = horizontal ? 0 : Math.PI / 2;
      drawRotated(IMAGES.body, seg.x, seg.y, angle, SPRITE_ANGLE_OFFSET.body);
    } else {
      // fallback
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(seg.x * TILE, seg.y * TILE, TILE, TILE);
    }
  }
}

function drawFood() {
  const baseX = food.x * TILE;
  const baseY = food.y * TILE;

  // puls: skala i alfa
  const pulse = Math.sin(_timeSec * 4);       // szybkość „oddechu”
  const scale = 1 + 0.20 * pulse;             // 1.0..1.20 (bardziej żywe)
  const alpha = 0.85 + 0.15 * pulse;          // ~0.70..1.0 (bardziej widoczne)

  const cx = baseX + TILE / 2;
  const cy = baseY + TILE / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  // opcjonalny cień, żeby jabłko wyglądało „goręcej”
  ctx.shadowBlur = 12;
  ctx.shadowColor = 'rgba(239,68,68,0.85)';
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  if (IMAGES.apple) {
    ctx.drawImage(IMAGES.apple, -TILE / 2, -TILE / 2, TILE, TILE);
  } else {
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-TILE / 2, -TILE / 2, TILE, TILE);
  }

  ctx.restore();
}

function drawHUD() {
  ctx.save();
  ctx.font = 'bold 18px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Neonowy efekt
  ctx.fillStyle = '#00ff99';
  ctx.shadowColor = '#00ff99';
  ctx.shadowBlur = 12;

  ctx.fillText(`Score: ${score}`, 8, 6);

  // Mute indicator (top-right)
  ctx.textAlign = 'right';
  ctx.fillText(audio.muted ? '🔇' : '🔊 (M)', canvas.width - 8, 6);
  ctx.textAlign = 'left';

  // Dodatkowa informacja w pauzie
  if (state === 'paused') {
    ctx.textAlign = 'right';
    ctx.fillText(`PAUSED`, canvas.width - 8, 6);
  }

  ctx.restore();
}

function drawOverlay(text, subtext) {
  ctx.save();

  // Gradient tła z delikatnym przejściem
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.7)');
  grad.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Tekst neonowy
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00ffcc';
  ctx.shadowColor = '#00ffcc';
  ctx.shadowBlur = 20;

  ctx.font = 'bold 32px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 16);

  if (subtext) {
    ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#80ffd9';
    ctx.fillText(subtext, canvas.width / 2, canvas.height / 2 + 18);
  }

  ctx.restore();
}

// Rysuje dużą cyfrę countdown w centrum ekranu
function drawCountdownOverlay() {
  // półprzezroczysty gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rem = countdownRemaining(_nowMs);      // ms
  const sec = Math.ceil(rem / 1000);           // 3,2,1,0
  const pct = 1 - (rem % 1000) / 1000;         // 0..1 w ramach bieżącej sekundy
  const scale = 1 + 0.15 * (1 - pct);          // lekki „wdech” cyfry

  const text = sec > 0 ? String(sec) : 'START';

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00ffcc';
  ctx.shadowColor = '#00ffcc';
  ctx.shadowBlur = 20;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.font = 'bold 64px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText(text, 0, -8);
  ctx.restore();

  ctx.restore();
}

// Renders a keyboard-style key box (label centered, optional sublabel below)
function drawKey(x, y, w, h, label, sublabel = null) {
  ctx.save();
  // key background
  ctx.fillStyle = 'rgba(10,14,20,0.95)';
  ctx.strokeStyle = 'rgba(0,255,170,0.18)';
  ctx.lineWidth = 1;
  const r = Math.max(4, Math.floor(Math.min(w, h) * 0.12));
  // rounded rect
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // label
  ctx.fillStyle = '#eafff7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(h * 0.45)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.fillText(label, x + w / 2, y + h * 0.42);

  if (sublabel) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.floor(h * 0.18)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(sublabel, x + w / 2, y + h * 0.82);
  }

  ctx.restore();
}

// Help / Controls screen
function drawHelpScreen() {
  drawGridBg();
  lastMenuButtons = [];

  // panel
  const SAFE = 28;
  const panelW = Math.min(canvas.width - SAFE * 2, 720);
  const panelH = Math.min(canvas.height - SAFE * 2, 520);
  const panelX = Math.floor((canvas.width - panelW) / 2);
  const panelY = Math.floor((canvas.height - panelH) / 2);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(0,255,170,0.18)';
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

  // title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#00ffcc';
  ctx.shadowColor = '#00ffcc';
  ctx.shadowBlur = 14;
  ctx.font = 'bold 24px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Sterowanie', panelX + panelW / 2, panelY + 18);
  ctx.shadowBlur = 0;

  // keys layout
  const gap = 18;
  const keyW = 84;
  const keyH = 64;
  const startX = panelX + 40;
  let curY = panelY + 64;

  // Movement keys (arrows)
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Ruch:', startX, curY + 8);

  const arrowsX = startX + 80;
  drawKey(arrowsX + keyW + gap, curY, keyW, keyH, '↑', 'Góra');
  drawKey(arrowsX, curY + keyH + 8, keyW, keyH, '←', 'Lewo');
  drawKey(arrowsX + keyW + gap, curY + keyH + 8, keyW, keyH, '↓', 'Dół');
  drawKey(arrowsX + (keyW + gap) * 2, curY + keyH + 8, keyW, keyH, '→', 'Prawo');

  // next row
  curY += keyH * 2 + 24;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('Inne:', startX, curY + 8);

  const keysX = startX + 80;
  drawKey(keysX, curY, keyW, keyH, 'P', 'Pauza');
  drawKey(keysX + keyW + gap, curY, keyW, keyH, 'M', 'Dźwięk');
  drawKey(keysX + (keyW + gap) * 2, curY, keyW, keyH, 'Space', 'Start');
  drawKey(keysX + (keyW + gap) * 3, curY, keyW, keyH, 'Esc', 'Powrót');

  // explanatory text
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const infoX = panelX + panelW / 2 + 10;
  let infoY = panelY + 90;
  ctx.fillText('- Strzałki sterują wężem (nie można zawrócić).', infoX, infoY);
  infoY += 22;
  ctx.fillText('- P lub Esc — pauza. W pauzie możesz użyć menu.', infoX, infoY);
  infoY += 22;
  ctx.fillText('- M — włącz/wyłącz dźwięk.', infoX, infoY);
  infoY += 22;
  ctx.fillText('- Space/Enter — potwierdź/zrestartuj gdy gra skończona.', infoX, infoY);

  // Back button (clickable)
  const btnW = 160, btnH = 38;
  const bx = panelX + Math.floor((panelW - btnW) / 2);
  const by = panelY + panelH - 56;
  ctx.fillStyle = 'rgba(0,255,170,0.06)';
  ctx.fillRect(bx, by, btnW, btnH);
  ctx.strokeStyle = 'rgba(0,255,170,0.45)';
  ctx.strokeRect(bx + 0.5, by + 0.5, btnW - 1, btnH - 1);
  ctx.fillStyle = '#eafff7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Powrót', bx + btnW / 2, by + btnH / 2);

  lastMenuButtons.push({ x: bx, y: by, w: btnW, h: btnH, onClick: () => { state = 'menu'; menuMode = 'main'; menuIndex = 0; }, label: 'Powrót' });

  ctx.restore();
}

/* =========================
   Rysowanie — ekrany
   ========================= */
function drawMenu() {
  drawGridBg();
  lastMenuButtons = [];

  const opts = getMenuOptions();
  const n = opts.length;

  // --- USTAWIENIA UI (responsywne) ---
  const SAFE = 32;            // margines od krawędzi canvasa
  const pad  = 20;            // padding panelu
  const footerH = 22;         // miejsce na hint w panelu
  let   vGap = 12;            // odstęp między przyciskami (może się zmieniać)
  let   btnW  = Math.floor(canvas.width * 0.68);
  let   minBtnH = 30, maxBtnH = 44;

  // Panel centrowany — ogranicz szerokość i wysokość
  const panelW = Math.min(canvas.width - SAFE*2, Math.max(320, btnW + pad*2));
  const panelH = Math.min(canvas.height - SAFE*2, Math.max(260, Math.floor(canvas.height - SAFE*2)));
  const panelX = Math.floor((canvas.width  - panelW)/2);
  const panelY = Math.floor((canvas.height - panelH)/2);

  // TŁO PANELU
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(0,255,170,0.25)';
  ctx.strokeRect(panelX+0.5, panelY+0.5, panelW-1, panelH-1);

  // GÓRNA STREFA KONTENTU
  let y = panelY + pad;

  // LOGO (skalowane do panelu)
  if (IMAGES.logo) {
    const maxLogoW = panelW - pad*2;
    const maxLogoH = Math.floor(panelH * 0.35); // maks 35% wysokości panelu
    const size = Math.min(maxLogoW, maxLogoH);
    ctx.drawImage(IMAGES.logo, panelX + (panelW - size)/2, y, size, size);
    y += size + 16; // odstęp pod logo
  }

  // TYTUŁ (gdy brak logo lub chcesz dodatkowy podpis)
  if (!IMAGES.logo) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '32px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(menuMode === 'sp' ? 'Single Player' : (menuMode === 'mp' ? 'Multiplayer' : 'S N A K E'),
                 panelX + panelW/2, y + 20);
    y += 56;
  }

  // PRZESTRZEŃ NA LISTĘ PRZYCISKÓW (między y a stopką)
  const contentBottom = panelY + panelH - pad - footerH - 16; // 16 = mały margines nad stopką
  const availableH = Math.max(100, contentBottom - y);

  // oblicz docelową wysokość przycisku, tak by n*btnH + (n-1)*vGap <= availableH
  let btnH = Math.min(maxBtnH, Math.floor((availableH - (n-1)*vGap) / n));
  if (btnH < minBtnH) {
    // spróbuj zmniejszyć gap
    vGap = Math.max(8, vGap - (minBtnH*n + (n-1)*8 - availableH));
    btnH = Math.min(maxBtnH, Math.floor((availableH - (n-1)*vGap) / n));
    btnH = Math.max(minBtnH, btnH);
  }

  // wycentruj pionowo blok przycisków w dostępnej przestrzeni
  const usedH = n*btnH + (n-1)*vGap;
  let listY = y + Math.floor((availableH - usedH)/2);
  const btnX = panelX + Math.floor((panelW - (panelW - pad*2))*0.5) + pad;
  const btnInnerW = panelW - pad*2;

  // rysowanie przycisków
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const isSel = (i === menuIndex);
    const bx = btnX, by = listY, bw = btnInnerW, bh = btnH;

    ctx.fillStyle = isSel ? 'rgba(0,255,170,0.18)' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = isSel ? 'rgba(0,255,170,0.6)' : 'rgba(255,255,255,0.2)';
    ctx.strokeRect(bx+0.5, by+0.5, bw-1, bh-1);

    ctx.fillStyle = '#eafff7';
    ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    const label = opts[i].label;
    ctx.fillText(label, panelX + panelW/2, by + bh/2);

    lastMenuButtons.push({ x: bx, y: by, w: bw, h: bh, onClick: opts[i].action, label });
    listY += bh + vGap;
  }

  // STOPKA (hint) – zawsze w panelu
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('↑/↓ — wybór   ·   Enter/Spacja — zatwierdź   ·   S — wyniki',
               panelX + panelW/2, panelY + panelH - pad - footerH/2);

  ctx.restore();
}

function drawScoresScreen() {
  drawGridBg();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';

  ctx.font = '28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Wyniki (Top 10)', canvas.width / 2, 24);

  const list = loadScores(); // [{name, score, date}]
  ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';

  if (!list || list.length === 0) {
    ctx.fillText('Brak wyników', canvas.width / 2, 70);
  } else {
    renderScoresList(ctx, list);
  }

  // Hint placed relative to the content (avoids anchoring to canvas.height so it won't be clipped)
  ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  const startY = 70;
  const rowH = 22;
  const items = list ? Math.min(list.length, 10) : 0;
  const hintY = startY + (items + 2) * rowH; // a little below the list
  ctx.fillText('Esc / Enter — powrót', canvas.width / 2, hintY);

  ctx.restore();
}

/* =========================
   Główny draw
   ========================= */
function draw() {
  clear();

  if (state === 'menu') {
    drawMenu();
    return;
  }

  if (state === 'scores') {
    drawScoresScreen();
    return;
  }

  if (state === 'help') {
    drawHelpScreen();
    return;
  }

  // Gra (running/paused/over)
  drawGridBg();
  drawObstacles();
  if (food) drawFood();
  if (snake.length) drawSnake();
  drawHUD();
  // ... po drawHUD();
  if (state === 'countdown') {
    drawCountdownOverlay();
  } else if (state === 'paused') {
    drawPauseMenuOverlay();
  } else if (state === 'over') {
    drawOverlay('GAME OVER', 'Naciśnij Space/Enter, aby zagrać ponownie');
  }
}

function drawPauseMenuOverlay() {
  // półprzezroczysty gradient na całym płótnie
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgba(0,0,0,0.65)');
  grad.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const opts = getPauseMenuOptions();
  // ------ USTAWIENIA UI ------
  const SAFE = 24;                         // margines od krawędzi canvasa
  let btnW = Math.floor(canvas.width * 0.68);
  let btnH = 36;
  let vGap = 12;
  const pad = 18;                          // padding panelu
  const titleH = 44;                       // wysokość bloku tytułu
  const footerH = 20;                      // wysokość linii podpowiedzi
  const n = opts.length;

  // policz wysokość potrzebną panelowi
  let neededH = pad + titleH + 12 + n * btnH + (n - 1) * vGap + 16 + footerH + pad;

  // jeśli nie mieści się — zmniejsz elementy
  if (neededH > canvas.height - SAFE * 2) {
    const shrink = (neededH - (canvas.height - SAFE * 2)) / neededH;
    // agresywniej ściskamy gapy niż przyciski
    vGap = Math.max(8, Math.floor(vGap * (1 - shrink * 1.2)));
    btnH = Math.max(30, Math.floor(btnH * (1 - shrink * 0.6)));
    neededH = pad + titleH + 12 + n * btnH + (n - 1) * vGap + 16 + footerH + pad;
    // w skrajności zawęź przyciski
    if (neededH > canvas.height - SAFE * 2) {
      btnW = Math.floor(canvas.width * 0.62);
      neededH = pad + titleH + 12 + n * btnH + (n - 1) * vGap + 16 + footerH + pad;
    }
  }

  // wymiary panelu (centrowany)
  const panelW = Math.min(canvas.width - SAFE * 2, Math.max(btnW + pad * 2, 260));
  const panelH = Math.min(canvas.height - SAFE * 2, neededH);
  const panelX = Math.floor((canvas.width - panelW) / 2);
  const panelY = Math.floor((canvas.height - panelH) / 2);

  // panel
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(0,255,170,0.25)';
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

  // tytuł
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00ffcc';
  ctx.shadowColor = '#00ffcc';
  ctx.shadowBlur = 18;
  ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('PAUZA', panelX + panelW / 2, panelY + pad + 16);

  ctx.shadowBlur = 0;

  // lista przycisków
  lastMenuButtons = [];
  const btnX = panelX + Math.floor((panelW - btnW) / 2);
  let y = panelY + pad + titleH + 12;
  for (let i = 0; i < n; i++) {
    const isSel = (i === pausedMenuIndex);
    const label = typeof opts[i].label === 'function' ? opts[i].label() : opts[i].label;

    ctx.fillStyle = isSel ? 'rgba(0,255,170,0.18)' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(btnX, y, btnW, btnH);
    ctx.strokeStyle = isSel ? 'rgba(0,255,170,0.6)' : 'rgba(255,255,255,0.2)';
    ctx.strokeRect(btnX + 0.5, y + 0.5, btnW - 1, btnH - 1);

    ctx.fillStyle = '#eafff7';
    ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText(label, panelX + panelW / 2, y + btnH / 2);

    lastMenuButtons.push({ x: btnX, y, w: btnW, h: btnH, onClick: opts[i].action, label });
    y += btnH + vGap;
  }

  // stopka z podpowiedziami — ZAWSZE w panelu, nie na samym dole canvasa
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('Esc/P — wznów   ·   ↑/↓ — wybór   ·   Enter/Spacja — zatwierdź   ·   M — dźwięk',
               panelX + panelW / 2, panelY + panelH - pad - footerH / 2);

  ctx.restore();
}

function drawObstacles() {
  if (!obstacles.length) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,255,170,0.35)'; // neonowy akcent
  for (const o of obstacles) {
    ctx.fillRect(o.x * TILE, o.y * TILE, TILE, TILE);
  }
  ctx.restore();
}

/* =========================
   Pętla renderowania
   ========================= */
let _timeSec = 0;
let _nowMs = 0;
function renderLoop(ts = 0) {
  _timeSec = ts / 1000;
  _nowMs = ts;

  // Obsługa odliczania
  if (state === 'countdown' && countdown) {
    const rem = countdownRemaining(_nowMs);
    const sec = Math.ceil(rem / 1000); // 3..2..1..0
    if (sec !== countdown.lastInt && sec > 0) {
      countdown.lastInt = sec;
      try { sTick(); } catch {}
    }
    if (rem <= 0) {
      state = 'running';
      try { sStart(); } catch {}
      countdown = null;
    }
  }

  draw();
  rafId = requestAnimationFrame(renderLoop);
}

/* =========================
   Jedzenie
   ========================= */
function spawnFood() {
  while (true) {
    const x = Math.floor(Math.random() * COLS);
    const y = Math.floor(Math.random() * ROWS);
    const onSnake = snake.some(s => s.x === x && s.y === y);
    if (!onSnake) return { x, y };
  }
}

/* =========================
   Leaderboard — haki
   ========================= */

/**
 * Wczytuje listę wyników z localStorage.
 * Zwraca posortowaną malejąco listę [{name, score, date}], maks. 10.
 */
function loadScores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(it => typeof it?.name === 'string' && Number.isFinite(it?.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Zapisuje wynik (prosty hak — na razie bez walidacji nazwy).
 * Jeśli wynik wejdzie do Top 10, lista jest przycinana do 10 pozycji.
 */
function saveScore(name, scoreVal) {
  try {
    const list = loadScores();
    list.push({ name: String(name || 'Anon'), score: Number(scoreVal) || 0, date: Date.now() });
    const top = list.sort((a, b) => b.score - a.score).slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(top));
    return top;
  } catch {
    // brak zapisu — ignorujemy
    return null;
  }
}

/**
 * Renderuje listę wyników w kolumnach: #, Imię, Wynik.
 */
function renderScoresList(ctx, list) {
  const col1 = canvas.width * 0.2;
  const col2 = canvas.width * 0.5;
  const col3 = canvas.width * 0.8;
  const startY = 70;
  const rowH = 22;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';

  // Nagłówki
  ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.fillText('#', col1, startY);
  ctx.fillText('Gracz', col2, startY);
  ctx.fillText('Wynik', col3, startY);

  // Pozycje
  ctx.font = '16px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  for (let i = 0; i < list.length && i < 10; i++) {
    const y = startY + (i + 1) * rowH;
    const item = list[i];
    ctx.fillText(String(i + 1), col1, y);
    ctx.fillText(item.name || 'Anon', col2, y);
    ctx.fillText(String(item.score), col3, y);
  }

  ctx.restore();
}

// --- Menu buttons hit-testing (once) ---
// lastMenuButtons is declared near the menu variables
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const clickable = (state === 'menu' || state === 'paused' || state === 'help');
  const isHot = clickable && !!hitButton(mx, my);
  document.body.style.cursor = isHot ? 'pointer' : 'default';
});

canvas.addEventListener('click', (e) => {
  const clickable = (state === 'menu' || state === 'paused' || state === 'help');
  if (!clickable) return;
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const btn = hitButton(mx, my);
  if (btn && btn.onClick) btn.onClick();
});

function hitButton(mx, my) {
  return lastMenuButtons.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
}

/* =========================
   Start
   ========================= */
// Nie zmieniamy logiki gry poza stanami: zaczynamy w MENU.
// Załaduj assety raz, potem zainicjalizuj i uruchom pętle.
(async function bootstrap() {
  try {
    await loadAssets();
  } catch (e) {
    // Jeśli ładowanie assetów zawiedzie, nadal kontynuujemy bez nich.
    console.warn('loadAssets failed:', e);
  }

  // Nie zmieniamy logiki gry poza stanami: zaczynamy w MENU.
  food = null;
  initSnake(); // aby mieć gotowego węża do ewentualnego tła, ale nie rysujemy go w menu
  renderLoop();

  // Upewnij się, że interwał update istnieje, ale update() nic nie zrobi w menu
  restartUpdateLoop();
})();
