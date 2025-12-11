// ============================================
// SLICE WORLD - Pure Game Logic (no I/O)
// ============================================

// Physics Constants
export const BASE_GRAVITY = 1500;
export const LAUNCH_RAMP_MS = 120;
export const MIN_LAUNCH_SCALE = 0.1;

// Spawn directions
export const DIRECTIONS = ['bottom', 'left', 'right', 'top'];

// Object type definitions with scoring and size multipliers
export const OBJECT_TYPES = {
  earth: { score: 1, sizeMultiplier: 1.4 },
  bomb: { score: 0, sizeMultiplier: 1.35, gameOver: true },
  gold: { score: 3, sizeMultiplier: 1.2 },
  alien: { score: 5, sizeMultiplier: 1.4, triggersFrenzy: true },
  neptune: { score: 2, sizeMultiplier: 1.3, triggersSlowMo: true }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Speed scaling based on score (difficulty ramping)
export function getSpeedScale(score) {
  const minScale = 0.6;
  const maxScale = 1.0;
  const scoreForMax = 30;
  const t = Math.min(score / scoreForMax, 1);
  return minScale + (maxScale - minScale) * t;
}

// Easing function for animations
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Distance calculation
export function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// ============================================
// SPAWN CHANCE CALCULATIONS
// ============================================

export function calculateSpawnChances(score) {
  const baseBombChance = 0.1;
  const extraFromScore = Math.min(score / 25 * 0.2, 0.25);
  const bombChance = Math.min(baseBombChance + extraFromScore, 0.45);

  const baseGoldChance = 0.08;
  const extraGoldFromScore = Math.min((score / 40) * 0.06, 0.04);
  const goldChance = Math.min(baseGoldChance + extraGoldFromScore, 0.14);

  const alienChance = 0.02;
  const neptuneChance = 0.03;

  return { bombChance, goldChance, alienChance, neptuneChance };
}

// Determine object type based on random roll and score
export function determineObjectType(roll, score, isFrenzyActive = false) {
  if (isFrenzyActive) {
    return 'alien';
  }

  const { bombChance, goldChance, alienChance, neptuneChance } = calculateSpawnChances(score);

  if (roll < alienChance) {
    return 'alien';
  } else if (roll < alienChance + neptuneChance) {
    return 'neptune';
  } else if (roll < alienChance + neptuneChance + goldChance) {
    return 'gold';
  } else if (roll < alienChance + neptuneChance + goldChance + bombChance) {
    return 'bomb';
  } else {
    return 'earth';
  }
}

// ============================================
// SPAWN DIFFICULTY CALCULATIONS
// ============================================

export function calculateDifficulty(elapsedMs, score) {
  const elapsedSec = elapsedMs / 1000;
  const timeFactor = Math.min(1 + elapsedSec / 40, 2.0);
  const scoreFactor = Math.min(1 + score / 25, 2.0);
  return Math.min(timeFactor * 0.6 + scoreFactor * 0.4, 2.2);
}

export function calculateSpawnInterval(difficulty, isFrenzyActive = false) {
  if (isFrenzyActive) {
    return 100 + Math.random() * 100;
  }
  return (550 + Math.random() * 350) / difficulty;
}

// ============================================
// SCORE CALCULATION
// ============================================

export function getScoreForType(type) {
  return OBJECT_TYPES[type]?.score || 0;
}

export function getSizeMultiplier(type) {
  return OBJECT_TYPES[type]?.sizeMultiplier || 1.0;
}

// Calculate bonus score for alien (random 2-5)
export function getAlienScore(randomValue) {
  return 2 + Math.floor(randomValue * 4);
}
