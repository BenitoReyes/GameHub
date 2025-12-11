// ============================================
// SLICE WORLD - Game I/O & Rendering
// ============================================

import {
  BASE_GRAVITY,
  DIRECTIONS,
  OBJECT_TYPES,
  getSpeedScale,
  easeOutCubic,
  dist,
  calculateSpawnChances,
  determineObjectType,
  calculateDifficulty,
  calculateSpawnInterval,
  getScoreForType,
  getSizeMultiplier,
  getAlienScore
} from './sliceWorldLogic.js';
import { getSocket } from '../commonLogic/socket.js';
import { getCookie } from '../commonLogic/cookie.js'
const socket = getSocket();
// Timing
let lastTime = performance.now();
// Alien Frenzy state
let alienFrenzyActive = false;
let alienFrenzyEndTime = 0;

// Time scaling (for slow-mo effects)
let timeScale = 1;
let slowMoTimeoutId = null;

// Game state
let gameOver = false;

// ============================================
// ORIENTATION CHECK
// ============================================

function checkOrientation() {
  const game = document.getElementById('game-container');
  if (game) game.style.display = 'flex';
}

window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

// ============================================
// MAIN GAME INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('Game script loaded');
  checkOrientation();

  // Canvas setup
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // Game state
  const objects = [];
  let objectSize = 64;
  let score = 0;
  // gameOver is defined globally for multiplayer callbacks
  let roundStartTime = 0;

  // Shield state
  let shieldActive = false;
  let shieldWasUsed = false;
  let shieldAvailable = true;

  // DOM elements
  const gameContainer = document.getElementById('game-container');
  const scoreDisplay = document.getElementById('score-value');
  const shieldIndicator = document.getElementById('shield-indicator');
  const hitFlash = document.getElementById('hit-flash');
  const frenzyButton = document.getElementById('frenzy-button');

  // ============================================
  // CANVAS RESIZING
  // ============================================

  function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }

  function resizeGameContainer() {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    if (gameContainer) {
      gameContainer.style.height = vh + 'px';
      gameContainer.style.width = '100%';
    }
    resizeCanvas();

    // Responsive object scaling
    const w = canvas.width;
    const h = canvas.height;
    const isPortrait = h >= w;

    if (isPortrait) {
      const minPx = Math.round(w * 0.12);
      const maxPx = Math.round(w * 0.18);
      const target = Math.round(w * 0.15);
      objectSize = Math.max(minPx, Math.min(maxPx, target));
    } else {
      const minPx = Math.round(w * 0.05);
      const maxPx = Math.round(w * 0.08);
      const target = Math.round(w * 0.065);
      objectSize = Math.max(minPx, Math.min(maxPx, target));
    }
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resizeGameContainer);
  }
  window.addEventListener('resize', resizeGameContainer);
  window.addEventListener('orientationchange', resizeGameContainer);
  resizeGameContainer();

  // ============================================
  // UI FEEDBACK
  // ============================================

  function bumpScore() {
    if (!scoreDisplay) return;
    scoreDisplay.textContent = score;

    scoreDisplay.classList.remove('score-pop');
    void scoreDisplay.offsetWidth;
    scoreDisplay.classList.add('score-pop');

    scoreDisplay.style.transition = 'transform 0.15s ease-out';
    scoreDisplay.style.transform = 'scale(1.25)';
    setTimeout(() => {
      scoreDisplay.style.transform = 'scale(1)';
    }, 160);
  }

  function triggerHitFlash() {
    if (!hitFlash) return;
    hitFlash.classList.remove('hit-flash-active');
    void hitFlash.offsetWidth;
    hitFlash.classList.add('hit-flash-active');
    setTimeout(() => {
      hitFlash.classList.remove('hit-flash-active');
    }, 100);
  }

  function updateShieldIndicator() {
    if (!shieldIndicator) return;
    if (shieldActive) {
      shieldIndicator.textContent = 'SHIELD ACTIVE';
      shieldIndicator.classList.add('shield-on');
      shieldIndicator.style.display = 'block';
    } else {
      shieldIndicator.textContent = '';
      shieldIndicator.classList.remove('shield-on');
      shieldIndicator.style.display = 'none';
    }
  }

  // ============================================
  // ABILITIES
  // ============================================

  window.activateShield = function() {
    if (!shieldAvailable || shieldActive) {
      console.log('[SHIELD] Already used this round');
      return false;
    }
    console.log('[SHIELD] Activated');
    shieldActive = true;
    shieldWasUsed = false;
    shieldAvailable = false;
    updateShieldIndicator();
    return true;
  };

  window.castStarSlash = function() {
    console.log('[ABILITY] Star Slash cast');
    let cleared = 0;
    for (let obj of objects) {
      if (obj.type === 'earth' && !obj.sliced) {
        spawnEarthSplitPieces(obj);
        obj.sliced = true;
        score++;
        cleared++;
      }
    }
    if (cleared > 0) {
      bumpScore();
      triggerHitFlash();
    }
  };

  window.castTimeSlow = function() {
    console.log('[ABILITY] Time Slow cast');
    if (slowMoTimeoutId !== null) {
      clearTimeout(slowMoTimeoutId);
      slowMoTimeoutId = null;
    }
    timeScale = 0.4;
    slowMoTimeoutId = setTimeout(() => {
      timeScale = 1;
      slowMoTimeoutId = null;
      console.log('[ABILITY] Time Slow ended');
    }, 5000);
  };

  // Shield button handler
  if (frenzyButton) {
    frenzyButton.addEventListener('click', () => {
      if (gameOver) return;
      const activated = window.activateShield();
      if (activated) {
        frenzyButton.classList.add('frenzy-used');
      }
    });
  }

  // ============================================
  // SWORD CLASS
  // ============================================

  class Sword {
    constructor() {
      this.swipes = [];
      this.maxSwipes = 6;
      this.fading = false;
      this.fadeStart = 0;
      this.fadeDuration = 200;
    }

    draw(ctx) {
      const pts = this.swipes;
      if (pts.length < 2) return;

      const alphaFactor = this.fading
        ? Math.max(0, 1 - (Date.now() - this.fadeStart) / this.fadeDuration)
        : 1;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Glow layer
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = `rgba(255,255,255,${0.06 * alphaFactor})`;
      ctx.lineWidth = 20;
      ctx.shadowColor = 'rgba(255,255,255,0.08)';
      ctx.shadowBlur = 8;
      ctx.globalCompositeOperation = 'lighter';
      ctx.stroke();

      // Core blade
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = `rgba(255,255,255,${0.95 * alphaFactor})`;
      ctx.lineWidth = 8;
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.stroke();

      // Bright edge
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = `rgba(255,255,255,${1 * alphaFactor})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    }

    update() {
      if (this.fading) {
        const elapsed = Date.now() - this.fadeStart;
        if (elapsed >= this.fadeDuration) {
          this.swipes.length = 0;
          this.fading = false;
        }
      }
    }

    checkSlice(obj) {
      if (obj.sliced || this.swipes.length < 2) return false;

      const size = obj.size || objectSize;
      const hitRadius = size * 0.9;
      const length = this.swipes.length;
      const stroke1 = this.swipes[length - 1];
      const stroke2 = this.swipes[length - 2];
      const cx = obj.x + size / 2;
      const cy = obj.y + size / 2;
      const d1 = dist(stroke1.x, stroke1.y, cx, cy);
      const d2 = dist(stroke2.x, stroke2.y, cx, cy);

      return d1 < hitRadius || d2 < hitRadius;
    }

    swipe(x, y) {
      if (this.fading) return;
      const last = this.swipes[this.swipes.length - 1];
      if (last && dist(last.x, last.y, x, y) < 3) return;
      this.swipes.push({ x, y });
      if (this.swipes.length > this.maxSwipes) {
        this.swipes.splice(0, this.swipes.length - this.maxSwipes);
      }
    }

    startFade() {
      if (this.swipes.length === 0) return;
      this.fading = true;
      this.fadeStart = Date.now();
    }
  }

  const sword = new Sword();

  // ============================================
  // LOAD IMAGES
  // ============================================

  const earthImg = new Image();
  earthImg.src = 'assets/earth_vector.png';

  const bombImg = new Image();
  bombImg.src = 'assets/reactor.png';

  const goldImg = new Image();
  goldImg.src = 'assets/saturn.png';

  const neptuneImg = new Image();
  neptuneImg.src = 'assets/neptune.png';

  const alienImg = new Image();
  alienImg.src = 'assets/alien.png';

  // ============================================
  // SPAWN LOGIC
  // ============================================

  function spawnObject(forcedType) {
    if (gameOver) return;

    const now = performance.now();
    const frenzyNow = alienFrenzyActive && now < alienFrenzyEndTime;
    let type;

    if (forcedType) {
      type = forcedType;
    } else if (frenzyNow) {
      type = 'alien';
    } else {
      const roll = Math.random();
      type = determineObjectType(roll, score, frenzyNow);
    }

    // Use size multiplier from logic module
    const size = Math.round(objectSize * getSizeMultiplier(type));
    const speedScale = getSpeedScale(score);
    const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    
    const spdVar = Math.random();
    const posVar = Math.random();

    let x, y, vx, vy;
    const spawnMargin = size + 10;

    switch (direction) {
      case 'bottom': {
        x = spawnMargin + posVar * (canvas.width - spawnMargin * 2);
        y = canvas.height + spawnMargin;
        const bottomSpeed = (1050 + spdVar * 150) * speedScale;
        const minAngle = (-115 * Math.PI) / 180;
        const maxAngle = (-65 * Math.PI) / 180;
        const angle = minAngle + posVar * (maxAngle - minAngle);
        vx = Math.cos(angle) * bottomSpeed;
        vy = Math.sin(angle) * bottomSpeed;
        break;
      }
      case 'top': {
        x = spawnMargin + posVar * (canvas.width - spawnMargin * 2);
        y = -spawnMargin;
        const topVxMax = 140 * speedScale;
        const topVyStart = (220 + spdVar * 120) * speedScale;
        vx = (posVar * 2 - 1) * topVxMax;
        vy = topVyStart;
        break;
      }
      case 'left': {
        x = -spawnMargin;
        y = canvas.height * (0.12 + posVar * 0.08);
        const targetX = canvas.width * (0.6 + spdVar * 0.3);
        const targetY = canvas.height * (0.25 + posVar * 0.15);
        let dx = targetX - x;
        let dy = targetY - y;
        const len = Math.hypot(dx, dy) || 1;
        const tunedSpeed = (700 + spdVar * 120) * speedScale;
        vx = (dx / len) * tunedSpeed;
        vy = (dy / len) * tunedSpeed;
        break;
      }
      case 'right': {
        x = canvas.width + spawnMargin;
        y = canvas.height * (0.12 + posVar * 0.08);
        const targetX = canvas.width * (0.1 + spdVar * 0.3);
        const targetY = canvas.height * (0.25 + posVar * 0.15);
        let dx = targetX - x;
        let dy = targetY - y;
        const len = Math.hypot(dx, dy) || 1;
        const tunedSpeed = (700 + spdVar * 120) * speedScale;
        vx = (dx / len) * tunedSpeed;
        vy = (dy / len) * tunedSpeed;
        break;
      }
    }

    objects.push({
      x, y, vx, vy, type,
      sliced: false,
      size,
      spawnTime: performance.now(),
      rotation: (Math.random() * 2 - 1) * 360 * (Math.PI / 180)
    });
  }

  // ============================================
  // SPLIT PIECE SPAWNERS
  // ============================================

  function spawnEarthSplitPieces(parent) {
    const size = parent.size || objectSize;
    const common = {
      type: 'earth_piece',
      sliced: true,
      size,
      spawnTime: performance.now(),
      r: parent.r || 0
    };
    objects.push({
      ...common,
      pieceSide: 'left',
      x: parent.x,
      y: parent.y,
      vx: parent.vx - 250,
      vy: parent.vy - 200,
      rotation: (Math.random() * 2 - 1) * 2
    });
    objects.push({
      ...common,
      pieceSide: 'right',
      x: parent.x + size / 2,
      y: parent.y,
      vx: parent.vx + 250,
      vy: parent.vy - 200,
      rotation: (Math.random() * 2 - 1) * 2
    });
  }

  function spawnAlienSplitPieces(parent) {
    const size = parent.size || objectSize;
    const common = {
      type: 'alien_piece',
      sliced: true,
      size,
      spawnTime: performance.now(),
      r: parent.r || 0
    };
    objects.push({
      ...common,
      pieceSide: 'left',
      x: parent.x,
      y: parent.y,
      vx: parent.vx - 250,
      vy: parent.vy - 200,
      rotation: (Math.random() * 2 - 1) * 2
    });
    objects.push({
      ...common,
      pieceSide: 'right',
      x: parent.x + size / 2,
      y: parent.y,
      vx: parent.vx + 250,
      vy: parent.vy - 200,
      rotation: (Math.random() * 2 - 1) * 2
    });
  }

  function spawnNeptuneSplitPieces(parent) {
    const size = parent.size || objectSize;
    const common = {
      type: 'neptune_piece',
      sliced: true,
      size,
      spawnTime: performance.now(),
      r: parent.r || 0
    };
    objects.push({
      ...common,
      pieceSide: 'left',
      x: parent.x,
      y: parent.y,
      vx: parent.vx - 250,
      vy: parent.vy - 200,
      rotation: (Math.random() * 2 - 1) * 2
    });
    objects.push({
      ...common,
      pieceSide: 'right',
      x: parent.x + size / 2,
      y: parent.y,
      vx: parent.vx + 250,
      vy: parent.vy - 200,
      rotation: (Math.random() * 2 - 1) * 2
    });
  }

  function spawnGoldSplitPieces(parent) {
    const size = parent.size || objectSize;
    const common = {
      type: 'gold_piece',
      sliced: true,
      size: size * 0.6,
      spawnTime: performance.now(),
      r: parent.r || 0
    };
    objects.push({
      ...common,
      x: parent.x,
      y: parent.y,
      vx: parent.vx - 260,
      vy: parent.vy - 220,
      rotation: (Math.random() * 2 - 1) * 4
    });
    objects.push({
      ...common,
      x: parent.x,
      y: parent.y,
      vx: parent.vx + 260,
      vy: parent.vy - 220,
      rotation: (Math.random() * 2 - 1) * 4
    });
  }

  // ============================================
  // GAME LOOP
  // ============================================

  function gameLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    const scaledDt = dt * timeScale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update and draw objects
    for (let obj of objects) {
      // Skip sliced objects (except split pieces)
      const pieceTypes = ['earth_piece', 'gold_piece', 'alien_piece', 'neptune_piece'];
      if (obj.sliced && !pieceTypes.includes(obj.type)) continue;

      // Physics
      const gravityScale = getSpeedScale(score);
      obj.vy += BASE_GRAVITY * gravityScale * scaledDt;
      obj.vx *= 0.996;
      obj.x += obj.vx * scaledDt;
      obj.y += obj.vy * scaledDt;

      // Rotation
      if (!obj.r) obj.r = 0;
      obj.r += (obj.rotation || 0) * scaledDt;

      // Draw
      const drawSize = obj.size || objectSize;
      drawObject(obj, drawSize);
    }

    // Draw sword trail
    sword.draw(ctx);
    sword.update();

    // Remove off-screen objects
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      const sz = obj.size || objectSize;
      if (timestamp - (obj.spawnTime || 0) < 500) continue;

      const margin = sz * 2;
      if (obj.x < -margin || obj.x > canvas.width + margin ||
          obj.y < -margin || obj.y > canvas.height + margin) {
        objects.splice(i, 1);
      }
    }

    if (!gameOver) requestAnimationFrame(gameLoop);
  }

  function drawObject(obj, drawSize) {
    switch (obj.type) {
      case 'earth':
        ctx.drawImage(earthImg, obj.x, obj.y, drawSize, drawSize);
        break;

      case 'earth_piece': {
        const pieceWidth = drawSize / 2;
        const srcW = earthImg.naturalWidth || earthImg.width || 0;
        const srcH = earthImg.naturalHeight || earthImg.height || 0;
        if (srcW && srcH) {
          const srcHalfW = Math.floor(srcW / 2);
          const sx = obj.pieceSide === 'right' ? srcHalfW : 0;
          ctx.drawImage(earthImg, sx, 0, srcHalfW, srcH, obj.x, obj.y, pieceWidth, drawSize);
        } else {
          ctx.drawImage(earthImg, obj.x, obj.y, pieceWidth, drawSize);
        }
        break;
      }

      case 'gold':
        ctx.drawImage(goldImg, obj.x, obj.y, drawSize, drawSize);
        break;

      case 'gold_piece':
        ctx.drawImage(goldImg, obj.x, obj.y, obj.size || drawSize * 0.6, obj.size || drawSize * 0.6);
        break;

      case 'alien':
        ctx.drawImage(alienImg, obj.x, obj.y, drawSize, drawSize);
        break;

      case 'alien_piece': {
        const pieceWidth = (obj.size || drawSize) / 2;
        const srcW = alienImg.width;
        const srcH = alienImg.height;
        const srcHalfW = srcW / 2;
        const sx = obj.pieceSide === 'left' ? 0 : srcHalfW;
        ctx.drawImage(alienImg, sx, 0, srcHalfW, srcH, obj.x, obj.y, pieceWidth, obj.size || drawSize);
        break;
      }

      case 'neptune':
        ctx.drawImage(neptuneImg, obj.x, obj.y, drawSize, drawSize);
        break;

      case 'neptune_piece': {
        const pieceWidth = (obj.size || drawSize) / 2;
        const srcW = neptuneImg.width;
        const srcH = neptuneImg.height;
        const srcHalfW = srcW / 2;
        const sx = obj.pieceSide === 'left' ? 0 : srcHalfW;
        ctx.drawImage(neptuneImg, sx, 0, srcHalfW, srcH, obj.x, obj.y, pieceWidth, obj.size || drawSize);
        break;
      }

      case 'bomb':
        ctx.drawImage(bombImg, obj.x, obj.y, drawSize, drawSize);
        break;
    }
  }

  // ============================================
  // SLICE HANDLING
  // ============================================

  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function handleSliceHits() {
    for (let obj of objects) {
      if (obj.sliced) continue;
      if (!sword.checkSlice(obj)) continue;

      // Mark as sliced
      obj.sliced = true;

      switch (obj.type) {
        case 'earth':
          spawnEarthSplitPieces(obj);
          score += getScoreForType('earth');
          bumpScore();
          triggerHitFlash();
          break;

        case 'gold':
          spawnGoldSplitPieces(obj);
          score += getScoreForType('gold');
          bumpScore();
          triggerHitFlash();
          break;

        case 'alien':
          spawnAlienSplitPieces(obj);
          score += getAlienScore(Math.random());
          bumpScore();
          triggerHitFlash();
          if (!alienFrenzyActive) {
            alienFrenzyActive = true;
            alienFrenzyEndTime = performance.now() + 5000;
            console.log('[FRENZY] Alien Frenzy started');
          }
          break;

        case 'neptune':
          spawnNeptuneSplitPieces(obj);
          score += getScoreForType('neptune');
          bumpScore();
          triggerHitFlash();
          window.castTimeSlow();
          break;

        case 'bomb':
          if (shieldActive) {
            shieldActive = false;
            shieldWasUsed = true;
            updateShieldIndicator();
            triggerHitFlash();
          } else {
            endGame();
          }
          break;
      }
    }
  }

  function processSwipePoint(x, y) {
    const last = sword.swipes[sword.swipes.length - 1];

    if (!last) {
      sword.swipe(x, y);
      handleSliceHits();
      return;
    }

    const dx = x - last.x;
    const dy = y - last.y;
    const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(maxDist / 24));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      sword.swipe(last.x + dx * t, last.y + dy * t);
      handleSliceHits();
    }
  }

  // ============================================
  // INPUT HANDLERS
  // ============================================

  let isTouching = false;

  canvas.addEventListener('touchstart', (e) => {
    if (gameOver) return;
    isTouching = true;
    const touch = e.touches[0];
    const pt = getCanvasCoords(touch.clientX, touch.clientY);
    sword.swipe(pt.x, pt.y);
  });

  canvas.addEventListener('touchmove', (e) => {
    if (gameOver || !isTouching) return;
    const touch = e.touches[0];
    const pt = getCanvasCoords(touch.clientX, touch.clientY);
    processSwipePoint(pt.x, pt.y);
  });

  canvas.addEventListener('touchend', () => {
    isTouching = false;
    sword.startFade();
  });

  canvas.addEventListener('touchcancel', () => {
    isTouching = false;
    sword.startFade();
  });

  let isMouseDown = false;

  canvas.addEventListener('mousedown', (e) => {
    if (gameOver) return;
    isMouseDown = true;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    sword.swipe(pt.x, pt.y);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (gameOver || !isMouseDown) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    processSwipePoint(pt.x, pt.y);
  });

  canvas.addEventListener('mouseup', () => {
    isMouseDown = false;
    sword.startFade();
  });

  canvas.addEventListener('mouseleave', () => {
    isMouseDown = false;
    sword.startFade();
  });

  // ============================================
  // GAME STATE
  // ============================================

  function endGame() {
    gameOver = true
    const userId = getCookie('userId')|| sessionStorage.getItem('userId');
    // DISCUSS MAKING SLICE WORLD ENDGAMES COUNT AS TOTAL GAMES
    //socket.emit('add-totalgames', userId);
    socket.emit('leaderboard-update',({
      userId: userId,
      gameType: 'sliceWorld',
      score: score
    }));
    setTimeout(() => {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '48px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2);
      ctx.font = '32px "Press Start 2P", monospace';
      ctx.fillText('Score: ' + score, canvas.width / 2, canvas.height / 2 + 60);
    }, 100);
  }

  function startGame() {
    score = 0;
    gameOver = false;
    objects.length = 0;
    bumpScore();

    // Reset shield
    shieldActive = false;
    shieldWasUsed = false;
    shieldAvailable = true;
    updateShieldIndicator();

    if (frenzyButton) {
      frenzyButton.classList.remove('frenzy-used');
    }

    // Reset time effects
    timeScale = 1;
    if (slowMoTimeoutId !== null) {
      clearTimeout(slowMoTimeoutId);
      slowMoTimeoutId = null;
    }

    // Reset frenzy
    alienFrenzyActive = false;
    alienFrenzyEndTime = 0;

    roundStartTime = performance.now();
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);

    // Spawn loop
    function spawnLoop() {
      if (gameOver) return;

      const now = performance.now();
      const elapsedSec = (now - roundStartTime) / 1000;
      const frenzyNow = alienFrenzyActive && now < alienFrenzyEndTime;

      const timeFactor = Math.min(1 + elapsedSec / 40, 2.0);
      const scoreFactor = Math.min(1 + score / 25, 2.0);
      const difficulty = Math.min(timeFactor * 0.6 + scoreFactor * 0.4, 2.2);

      if (frenzyNow) {
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) spawnObject();
      } else {
        spawnObject();
        const extraChance = Math.min(0.10 + (difficulty - 1) * 0.20, 0.45);
        if (Math.random() < extraChance) spawnObject();
      }

      const next = frenzyNow
        ? 100 + Math.random() * 100
        : (550 + Math.random() * 350) / difficulty;

      setTimeout(spawnLoop, next);
    }

    spawnLoop();
  }

  // Start the game
  startGame();

});
