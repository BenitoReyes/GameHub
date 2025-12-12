import { getSocket } from '../commonLogic/socket.js';
import { getCookie } from '../commonLogic/cookie.js'
const socket = getSocket();

// PIG LAUNCH GAME LOGIC
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Set canvas size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight - 80; // Account for header

// Game Constants
const GRAVITY = 0.5;
let GROUND_Y = window.innerHeight - 130; // Will be updated when canvas initializes
let SLINGSHOT_X = 150;
let SLINGSHOT_Y = GROUND_Y - 50;
const MAX_PULL = 150;

// Material Types
const MATERIALS = {
    ICE: { hp: 50, color: '#B0E0E6', emoji: '🧊', breakSound: 'crack' },
    WOOD: { hp: 100, color: '#D2691E', emoji: '🪵', breakSound: 'snap' },
    METAL: { hp: 200, color: '#808080', emoji: '🔩', breakSound: 'clang' }
};

// Pig Types
const PIG_TYPES = {
    splitter: {
        emoji: '🐷',
        name: 'Splitter',
        damage: 30,
        mass: 1,
        ability: 'split',
        description: 'Splits into 3 small pigs that break ice'
    },
    speedy: {
        emoji: '🐽',
        name: 'Speedy',
        damage: 40,
        mass: 0.8,
        ability: 'speed',
        description: 'Shoots forward at high speed, destroys wood'
    },
    screamer: {
        emoji: '🐖',
        name: 'Screamer',
        damage: 20,
        mass: 1.2,
        ability: 'scream',
        description: 'Screams to damage all structures'
    },
    bomber: {
        emoji: '💣',
        name: 'Bomber',
        damage: 100,
        mass: 1.5,
        ability: 'explode',
        description: 'Explodes on impact'
    }
};

// Game State
let gameState = {
    level: 1,
    score: 0,
    scoreAtLevelStart: 0,
    pigsRemaining: 5,
    currentPigType: 'splitter',
    launchedPig: null,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    structures: [],
    birds: [],
    particles: [],
    smallPigs: [],
    abilityUsed: false,
    gameStarted: false,
    checkingWinCondition: false,
    cloudOffset: 0
};

// Level Configurations
const LEVELS = [
    {
        structures: [
            { x: 900, y: GROUND_Y - 100, width: 20, height: 100, material: 'ICE' },
            { x: 1000, y: GROUND_Y - 100, width: 20, height: 100, material: 'ICE' },
            { x: 900, y: GROUND_Y - 120, width: 120, height: 20, material: 'ICE' }
        ],
        birds: [
            { x: 960, y: GROUND_Y - 140, radius: 15, hp: 3 }
        ]
    },
    {
        structures: [
            { x: 850, y: GROUND_Y - 150, width: 20, height: 150, material: 'WOOD' },
            { x: 1000, y: GROUND_Y - 150, width: 20, height: 150, material: 'WOOD' },
            { x: 870, y: GROUND_Y - 170, width: 130, height: 20, material: 'WOOD' },
            { x: 900, y: GROUND_Y - 80, width: 20, height: 80, material: 'ICE' },
            { x: 950, y: GROUND_Y - 80, width: 20, height: 80, material: 'ICE' },
            { x: 920, y: GROUND_Y - 100, width: 30, height: 20, material: 'ICE' }
        ],
        birds: [
            { x: 935, y: GROUND_Y - 190, radius: 15, hp: 3 },
            { x: 935, y: GROUND_Y - 120, radius: 15, hp: 3 }
        ]
    },
    {
        structures: [
            { x: 800, y: GROUND_Y - 200, width: 20, height: 200, material: 'METAL' },
            { x: 1000, y: GROUND_Y - 200, width: 20, height: 200, material: 'METAL' },
            { x: 820, y: GROUND_Y - 220, width: 160, height: 20, material: 'METAL' },
            { x: 860, y: GROUND_Y - 100, width: 20, height: 100, material: 'WOOD' },
            { x: 940, y: GROUND_Y - 100, width: 20, height: 100, material: 'WOOD' },
            { x: 880, y: GROUND_Y - 50, width: 20, height: 50, material: 'ICE' },
            { x: 920, y: GROUND_Y - 50, width: 20, height: 50, material: 'ICE' }
        ],
        birds: [
            { x: 910, y: GROUND_Y - 240, radius: 15, hp: 3 },
            { x: 900, y: GROUND_Y - 120, radius: 15, hp: 3 },
            { x: 900, y: GROUND_Y - 70, radius: 15, hp: 3 }
        ]
    },
    {
        structures: [
            { x: 750, y: GROUND_Y - 250, width: 25, height: 250, material: 'METAL' },
            { x: 1050, y: GROUND_Y - 250, width: 25, height: 250, material: 'METAL' },
            { x: 775, y: GROUND_Y - 270, width: 275, height: 25, material: 'METAL' },
            { x: 825, y: GROUND_Y - 180, width: 20, height: 180, material: 'WOOD' },
            { x: 980, y: GROUND_Y - 180, width: 20, height: 180, material: 'WOOD' },
            { x: 845, y: GROUND_Y - 200, width: 135, height: 20, material: 'WOOD' },
            { x: 875, y: GROUND_Y - 120, width: 20, height: 120, material: 'ICE' },
            { x: 930, y: GROUND_Y - 120, width: 20, height: 120, material: 'ICE' },
            { x: 895, y: GROUND_Y - 140, width: 35, height: 20, material: 'ICE' },
            { x: 810, y: GROUND_Y - 60, width: 20, height: 60, material: 'WOOD' },
            { x: 995, y: GROUND_Y - 60, width: 20, height: 60, material: 'WOOD' }
        ],
        birds: [
            { x: 912, y: GROUND_Y - 295, radius: 15, hp: 3 },
            { x: 902, y: GROUND_Y - 220, radius: 15, hp: 3 },
            { x: 912, y: GROUND_Y - 160, radius: 15, hp: 3 },
            { x: 820, y: GROUND_Y - 80, radius: 15, hp: 3 },
            { x: 1005, y: GROUND_Y - 80, radius: 15, hp: 3 }
        ]
    },
    {
        structures: [
            { x: 700, y: GROUND_Y - 300, width: 30, height: 300, material: 'METAL' },
            { x: 1100, y: GROUND_Y - 300, width: 30, height: 300, material: 'METAL' },
            { x: 730, y: GROUND_Y - 320, width: 370, height: 20, material: 'METAL' },
            { x: 780, y: GROUND_Y - 250, width: 25, height: 250, material: 'METAL' },
            { x: 1025, y: GROUND_Y - 250, width: 25, height: 250, material: 'METAL' },
            { x: 805, y: GROUND_Y - 270, width: 220, height: 20, material: 'METAL' },
            { x: 850, y: GROUND_Y - 200, width: 20, height: 200, material: 'WOOD' },
            { x: 980, y: GROUND_Y - 200, width: 20, height: 200, material: 'WOOD' },
            { x: 870, y: GROUND_Y - 220, width: 110, height: 20, material: 'WOOD' },
            { x: 890, y: GROUND_Y - 150, width: 20, height: 150, material: 'ICE' },
            { x: 950, y: GROUND_Y - 150, width: 20, height: 150, material: 'ICE' },
            { x: 910, y: GROUND_Y - 170, width: 40, height: 20, material: 'ICE' },
            { x: 760, y: GROUND_Y - 100, width: 20, height: 100, material: 'WOOD' },
            { x: 1050, y: GROUND_Y - 100, width: 20, height: 100, material: 'WOOD' },
            { x: 820, y: GROUND_Y - 80, width: 20, height: 80, material: 'ICE' },
            { x: 990, y: GROUND_Y - 80, width: 20, height: 80, material: 'ICE' }
        ],
        birds: [
            { x: 915, y: GROUND_Y - 340, radius: 25, isBoss: true, hp: 12 },
            { x: 915, y: GROUND_Y - 290, radius: 15, hp: 3 },
            { x: 915, y: GROUND_Y - 240, radius: 15, hp: 3 },
            { x: 920, y: GROUND_Y - 190, radius: 15, hp: 3 },
            { x: 770, y: GROUND_Y - 120, radius: 15, hp: 3 },
            { x: 1060, y: GROUND_Y - 120, radius: 15, hp: 3 },
            { x: 830, y: GROUND_Y - 100, radius: 15, hp: 3 }
        ]
    }
];

// Pig Class
class Pig {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = 20;
        this.type = type;
        this.typeData = PIG_TYPES[type];
        this.rotation = 0;
        this.active = true;
        this.isSmall = false;
    }

    update() {
        if (!this.active) return;

        // Apply minimal air resistance for consistent flight
        this.vx *= 0.985;
        this.vy += GRAVITY * this.typeData.mass;
        this.x += this.vx;
        this.y += this.vy;
        this.rotation += 0.1;

        // Ground collision
        if (this.y + this.radius >= GROUND_Y) {
            this.y = GROUND_Y - this.radius;
            this.vy *= -0.3;
            this.vx *= 0.8;

            if (Math.abs(this.vy) < 1 && Math.abs(this.vx) < 1) {
                this.active = false;
            }
        }

        // Check collisions with structures and birds
        this.checkCollisions();
    }

    checkCollisions() {
        // Check structure collisions
        gameState.structures.forEach((structure, index) => {
            if (this.collidesWith(structure)) {
                const damage = this.calculateDamage(structure.material);
                structure.hp -= damage;

                createParticles(this.x, this.y, structure.material);

                // Make structure fall when heavily damaged
                if (structure.hp <= structure.maxHp * 0.3) {
                    structure.falling = true;
                    structure.vx = this.vx * 0.3;
                    structure.vy = this.vy * 0.3;
                }

                if (structure.hp <= 0) {
                    gameState.structures.splice(index, 1);
                    // Don't add score here - only add on level completion
                }

                // Speedy pig passes through wood after ability, bounces off ice and metal
                if (this.type === 'speedy' && gameState.abilityUsed && structure.material === 'WOOD') {
                    // Pass through wood - no bounce
                } else {
                    this.bounce();
                }
            }
        });

        // Check bird collisions
        gameState.birds.forEach((bird, index) => {
            const dx = this.x - bird.x;
            const dy = this.y - bird.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < this.radius + bird.radius) {
                // Damage bird (1 HP for regular birds, multiple HP for boss)
                bird.hp -= 1;
                bird.disturbed = true;
                createParticles(bird.x, bird.y, 'BIRD');

                // Only make bird fall if HP reaches 0
                if (bird.hp <= 0) {
                    bird.falling = true;
                    bird.vx = this.vx * 0.5;
                    bird.vy = -5; // Pop up then fall
                }

                this.bounce();
            }
        });
    }

    collidesWith(structure) {
        const closestX = Math.max(structure.x, Math.min(this.x, structure.x + structure.width));
        const closestY = Math.max(structure.y, Math.min(this.y, structure.y + structure.height));

        const dx = this.x - closestX;
        const dy = this.y - closestY;

        return (dx * dx + dy * dy) < (this.radius * this.radius);
    }

    calculateDamage(material) {
        let baseDamage = this.typeData.damage;

        // Type advantages
        if (this.type === 'splitter' && material === 'ICE') baseDamage *= 1.5;
        if (this.type === 'speedy' && material === 'WOOD') baseDamage *= 1.5;
        if (this.type === 'bomber') baseDamage *= 2;

        // Small pigs do less damage
        if (this.isSmall) baseDamage *= 0.5;

        return baseDamage;
    }

    bounce() {
        this.vx *= -0.5;
        this.vy *= -0.5;
    }

    activateAbility() {
        if (gameState.abilityUsed) return;
        gameState.abilityUsed = true;

        switch (this.type) {
            case 'splitter':
                this.split();
                break;
            case 'speedy':
                this.speedBoost();
                break;
            case 'screamer':
                this.scream();
                break;
            case 'bomber':
                this.explode();
                break;
        }
    }

    split() {
        this.active = false;

        // Create 3 smaller pigs with spread pattern
        const angles = [-0.3, 0, 0.3]; // Spread pattern

        angles.forEach((angle, i) => {
            const smallPig = new Pig(this.x, this.y, 'splitter');
            smallPig.isSmall = true;
            smallPig.radius = 12;

            // Spread pigs in different directions
            const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            const currentAngle = Math.atan2(this.vy, this.vx);
            const newAngle = currentAngle + angle;

            smallPig.vx = Math.cos(newAngle) * speed * 0.8;
            smallPig.vy = Math.sin(newAngle) * speed * 0.8;
            smallPig.active = true;

            // Add to game state for tracking
            if (!gameState.smallPigs) gameState.smallPigs = [];
            gameState.smallPigs.push(smallPig);
        });
    }

    speedBoost() {
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        const angle = Math.atan2(this.vy, this.vx);
        this.vx = Math.cos(angle) * speed * 3;
        this.vy = Math.sin(angle) * speed * 3;
    }

    scream() {
        // Damage all structures
        gameState.structures.forEach(structure => {
            structure.hp -= 30;
            structure.damaged = true;
            createParticles(structure.x + structure.width / 2, structure.y, structure.material);
        });

        // Damage all birds - scales with health (1 damage for regular, 3 for boss = 4 screams)
        gameState.birds.forEach(bird => {
            const damage = Math.max(1, Math.floor(bird.maxHp / 4)); // 1 for regular birds (3/4), 3 for boss (12/4)
            bird.hp -= damage;
            bird.disturbed = true;
            createParticles(bird.x, bird.y, 'BIRD');

            if (bird.hp <= 0) {
                bird.falling = true;
                bird.vx = (Math.random() - 0.5) * 3;
                bird.vy = -5;
            }
        });

        // Remove destroyed structures
        gameState.structures = gameState.structures.filter(s => s.hp > 0);

        // Visual effect
        createScreamWave(this.x, this.y);
    }

    explode() {
        const explosionRadius = 100;

        // Damage nearby structures
        gameState.structures.forEach(structure => {
            const centerX = structure.x + structure.width / 2;
            const centerY = structure.y + structure.height / 2;
            const dx = centerX - this.x;
            const dy = centerY - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < explosionRadius) {
                structure.hp -= 150;
                structure.damaged = true;
                createParticles(centerX, centerY, structure.material);
            }
        });

        // Damage nearby birds
        gameState.birds.forEach(bird => {
            const dx = bird.x - this.x;
            const dy = bird.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < explosionRadius) {
                bird.hp -= 3; // Explosion does 3 damage
                bird.disturbed = true;
                createParticles(bird.x, bird.y, 'BIRD');

                if (bird.hp <= 0) {
                    bird.falling = true;
                    bird.vx = (Math.random() - 0.5) * 5;
                    bird.vy = -8;
                }
            }
        });

        // Remove destroyed birds
        gameState.birds = gameState.birds.filter(bird => {
            if (bird.hp <= 0 && bird.falling) {
                gameState.score += 100;
                return false;
            }
            return true;
        });

        // Remove destroyed structures
        gameState.structures = gameState.structures.filter(s => s.hp > 0);

        // Visual explosion
        createExplosion(this.x, this.y);

        this.active = false;
    }

    draw() {
        if (!this.active) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        ctx.font = `${this.radius * 2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.typeData.emoji, 0, 0);

        ctx.restore();
    }
}

// Particle System
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10 - 3;
        this.life = 1;
        this.color = color;
        this.size = Math.random() * 5 + 2;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += GRAVITY * 0.5;
        this.life -= 0.02;
    }

    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1;
    }
}

function createParticles(x, y, material) {
    let color;
    switch (material) {
        case 'ICE': color = '#B0E0E6'; break;
        case 'WOOD': color = '#D2691E'; break;
        case 'METAL': color = '#808080'; break;
        case 'BIRD': color = '#FFD700'; break;
        default: color = '#ffffff';
    }

    for (let i = 0; i < 15; i++) {
        gameState.particles.push(new Particle(x, y, color));
    }
}

function createExplosion(x, y) {
    for (let i = 0; i < 30; i++) {
        gameState.particles.push(new Particle(x, y, '#FF4500'));
    }
}

function createScreamWave(x, y) {
    for (let i = 0; i < 20; i++) {
        const angle = (i / 20) * Math.PI * 2;
        const particle = new Particle(x, y, '#FF69B4');
        particle.vx = Math.cos(angle) * 8;
        particle.vy = Math.sin(angle) * 8;
        gameState.particles.push(particle);
    }
}

function updatePig(pig) {
    const updateInterval = setInterval(() => {
        pig.update();
        if (!pig.active) {
            clearInterval(updateInterval);
        }
    }, 1000 / 60);
}

// Initialize Level
function initLevel(levelNum) {
    const level = LEVELS[levelNum - 1];
    if (!level) {
        alert('Congratulations! You completed all levels!');
        location.href = '../../homepage.html';
        return;
    }

    // Save score at the start of the level
    gameState.scoreAtLevelStart = gameState.score;

    gameState.structures = level.structures.map(s => ({
        ...s,
        hp: MATERIALS[s.material].hp,
        maxHp: MATERIALS[s.material].hp,
        vx: 0,
        vy: 0,
        rotation: 0,
        falling: false,
        damaged: false
    }));

    gameState.birds = level.birds.map(b => ({
        ...b,
        vx: 0,
        vy: 0,
        falling: false,
        disturbed: false,
        isBoss: b.isBoss || false,
        hp: b.hp || 1,
        maxHp: b.hp || 1
    }));
    gameState.pigsRemaining = 5;
    gameState.launchedPig = null;
    gameState.particles = [];
    gameState.smallPigs = [];
    gameState.abilityUsed = false;
    gameState.gameStarted = false;
    gameState.checkingWinCondition = false;

    document.getElementById('levelNum').textContent = levelNum;
    document.getElementById('score').textContent = gameState.score;
}

// Draw Functions
function drawBackground() {
    // Animate cloud movement
    gameState.cloudOffset += 0.2;
    if (gameState.cloudOffset > canvas.width) {
        gameState.cloudOffset = 0;
    }

    // Draw hills in background
    const hillColors = ['#90C088', '#7AB876', '#68A065'];

    // Back hills (darker)
    ctx.fillStyle = hillColors[2];
    ctx.beginPath();
    ctx.moveTo(-50, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.15, GROUND_Y - 250, canvas.width * 0.35, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.55, GROUND_Y - 180, canvas.width * 0.75, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.9, GROUND_Y - 220, canvas.width + 50, GROUND_Y);
    ctx.lineTo(canvas.width + 50, GROUND_Y);
    ctx.lineTo(-50, GROUND_Y);
    ctx.fill();

    // Middle hills
    ctx.fillStyle = hillColors[1];
    ctx.beginPath();
    ctx.moveTo(-50, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.25, GROUND_Y - 200, canvas.width * 0.5, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.7, GROUND_Y - 150, canvas.width + 50, GROUND_Y);
    ctx.lineTo(canvas.width + 50, GROUND_Y);
    ctx.lineTo(-50, GROUND_Y);
    ctx.fill();

    // Front hills (lighter)
    ctx.fillStyle = hillColors[0];
    ctx.beginPath();
    ctx.moveTo(-50, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.2, GROUND_Y - 120, canvas.width * 0.4, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.6, GROUND_Y - 100, canvas.width * 0.8, GROUND_Y);
    ctx.quadraticCurveTo(canvas.width * 0.95, GROUND_Y - 80, canvas.width + 50, GROUND_Y);
    ctx.lineTo(canvas.width + 50, GROUND_Y);
    ctx.lineTo(-50, GROUND_Y);
    ctx.fill();
}

function drawClouds() {
    ctx.save();

    // Draw multiple clouds at different positions
    const clouds = [
        { x: -200, y: 80, size: 1.2 },
        { x: 200, y: 150, size: 0.9 },
        { x: 500, y: 100, size: 1.1 },
        { x: 800, y: 180, size: 0.8 },
        { x: 1100, y: 120, size: 1.0 }
    ];

    clouds.forEach(cloud => {
        drawCloud(cloud.x + gameState.cloudOffset, cloud.y, cloud.size);
        // Draw duplicate for seamless loop
        drawCloud(cloud.x + gameState.cloudOffset - canvas.width - 400, cloud.y, cloud.size);
    });

    ctx.restore();
}

function drawCloud(x, y, scale) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';

    // Cloud made of circles
    ctx.beginPath();
    ctx.arc(x, y, 25 * scale, 0, Math.PI * 2);
    ctx.arc(x + 20 * scale, y - 10 * scale, 30 * scale, 0, Math.PI * 2);
    ctx.arc(x + 45 * scale, y - 5 * scale, 28 * scale, 0, Math.PI * 2);
    ctx.arc(x + 65 * scale, y, 25 * scale, 0, Math.PI * 2);
    ctx.arc(x + 35 * scale, y + 8 * scale, 22 * scale, 0, Math.PI * 2);
    ctx.fill();
}

function drawGround() {
    ctx.fillStyle = '#8B7355';
    ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

    // Grass
    ctx.fillStyle = '#228B22';
    ctx.fillRect(0, GROUND_Y, canvas.width, 10);
}

function drawSlingshot() {
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Left fork arm
    ctx.beginPath();
    ctx.moveTo(SLINGSHOT_X - 30, SLINGSHOT_Y - 50);
    ctx.lineTo(SLINGSHOT_X - 10, SLINGSHOT_Y - 20);
    ctx.stroke();

    // Right fork arm
    ctx.beginPath();
    ctx.moveTo(SLINGSHOT_X + 30, SLINGSHOT_Y - 50);
    ctx.lineTo(SLINGSHOT_X + 10, SLINGSHOT_Y - 20);
    ctx.stroke();

    // Main pole (stem of the Y)
    ctx.beginPath();
    ctx.moveTo(SLINGSHOT_X, GROUND_Y);
    ctx.lineTo(SLINGSHOT_X, SLINGSHOT_Y - 20);
    ctx.stroke();

    // Band
    if (gameState.isDragging) {
        ctx.strokeStyle = '#654321';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(SLINGSHOT_X - 30, SLINGSHOT_Y - 50);
        ctx.lineTo(gameState.dragStart.x, gameState.dragStart.y);
        ctx.lineTo(SLINGSHOT_X + 30, SLINGSHOT_Y - 50);
        ctx.stroke();
    } else if (!gameState.launchedPig) {
        // Draw pig on slingshot
        ctx.font = '40px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PIG_TYPES[gameState.currentPigType].emoji, SLINGSHOT_X, SLINGSHOT_Y);
    }
}

function checkStructureSupport() {
    // Don't check support until gameplay has started
    if (!gameState.gameStarted) return;

    // Only check support after something has been hit/damaged
    // Check each structure to see if it has support below
    gameState.structures.forEach(structure => {
        if (structure.falling) return;

        // Don't check support for undamaged structures
        if (!structure.damaged) return;

        const structureBottom = structure.y + structure.height;
        const isOnGround = structureBottom >= GROUND_Y - 5;

        if (isOnGround) return; // On ground = supported

        // Check if any structure below supports this one
        let hasSupport = false;
        gameState.structures.forEach(other => {
            if (other === structure || other.falling) return;

            const isBelow = other.y < structure.y + structure.height && 
                           other.y + other.height > structure.y + structure.height - 10;
            const hasHorizontalOverlap = 
                (structure.x < other.x + other.width && structure.x + structure.width > other.x);

            if (isBelow && hasHorizontalOverlap) {
                hasSupport = true;
            }
        });

        // If no support, make it fall
        if (!hasSupport) {
            structure.falling = true;
            structure.vx = (Math.random() - 0.5) * 2;
            structure.vy = 0;
        }
    });
}

function drawStructures() {
    // Check for unsupported structures
    checkStructureSupport();

    gameState.structures.forEach((structure, index) => {
        // Apply physics to falling structures
        if (structure.falling) {
            structure.vy += GRAVITY;
            structure.x += structure.vx;
            structure.y += structure.vy;
            structure.rotation += 0.05;
            structure.vx *= 0.98;

            // Mark nearby birds as disturbed
            gameState.birds.forEach(bird => {
                const dx = (structure.x + structure.width / 2) - bird.x;
                const dy = (structure.y + structure.height / 2) - bird.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 100) { // If structure is falling near a bird
                    bird.disturbed = true;
                }
            });

            // Remove if off screen or hit ground
            if (structure.y >= GROUND_Y || structure.y > canvas.height) {
                gameState.structures.splice(index, 1);
                gameState.score += 50;
                return;
            }
        }

        const material = MATERIALS[structure.material];

        ctx.save();
        if (structure.falling) {
            ctx.translate(structure.x + structure.width / 2, structure.y + structure.height / 2);
            ctx.rotate(structure.rotation);
            ctx.fillStyle = material.color;
            ctx.fillRect(-structure.width / 2, -structure.height / 2, structure.width, structure.height);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(-structure.width / 2, -structure.height / 2, structure.width, structure.height);
        } else {
            ctx.fillStyle = material.color;
            ctx.fillRect(structure.x, structure.y, structure.width, structure.height);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.strokeRect(structure.x, structure.y, structure.width, structure.height);

            // HP bar (only for non-falling structures)
            const hpPercent = structure.hp / structure.maxHp;
            const barWidth = structure.width;
            const barHeight = 5;

            ctx.fillStyle = '#ff0000';
            ctx.fillRect(structure.x, structure.y - 10, barWidth, barHeight);

            ctx.fillStyle = '#00ff00';
            ctx.fillRect(structure.x, structure.y - 10, barWidth * hpPercent, barHeight);
        }
        ctx.restore();
    });
}

function checkBirdSupport() {
    // Only check bird support after something has been hit
    // Check if birds have support beneath them
    gameState.birds.forEach(bird => {
        if (bird.falling) return;

        // Don't check support for birds that haven't been disturbed
        if (!bird.disturbed) return;

        let hasSupport = false;

        // Check if bird is on ground
        if (bird.y >= GROUND_Y - bird.radius - 5) {
            hasSupport = true;
            return;
        }

        // Check if any structure supports this bird
        gameState.structures.forEach(structure => {
            if (structure.falling) return;

            const birdBottom = bird.y + bird.radius;
            const isOnTop = birdBottom >= structure.y - 5 && 
                           birdBottom <= structure.y + 10;
            const isAbove = bird.x >= structure.x - bird.radius && 
                           bird.x <= structure.x + structure.width + bird.radius;

            if (isOnTop && isAbove) {
                hasSupport = true;
            }
        });

        // If no support, make it fall
        if (!hasSupport) {
            bird.falling = true;
            bird.vx = (Math.random() - 0.5) * 3;
            bird.vy = 0;
        }
    });
}

function drawBirds() {
    // Check for unsupported birds
    checkBirdSupport();

    gameState.birds.forEach((bird, index) => {
        // Apply gravity to falling birds
        if (bird.falling) {
            bird.vy += GRAVITY * 0.8;
            bird.x += bird.vx;
            bird.y += bird.vy;
            bird.vx *= 0.98;

            // Remove if hit ground
            if (bird.y >= GROUND_Y - bird.radius) {
                gameState.birds.splice(index, 1);
                gameState.score += 100;
                return;
            }
        }

        // Draw bird with size based on radius
        const fontSize = bird.radius * 2;
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐦', bird.x, bird.y);

        // Draw crown on boss bird
        if (bird.isBoss) {
            ctx.font = `${fontSize * 0.6}px Arial`;
            ctx.fillText('👑', bird.x, bird.y - bird.radius - 5);

            // HP bar for boss bird
            if (bird.hp > 0) {
                const barWidth = bird.radius * 3;
                const barHeight = 6;
                const barX = bird.x - barWidth / 2;
                const barY = bird.y - bird.radius - 20;

                ctx.fillStyle = '#ff0000';
                ctx.fillRect(barX, barY, barWidth, barHeight);

                const hpPercent = bird.hp / bird.maxHp;
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);

                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.strokeRect(barX, barY, barWidth, barHeight);
            }
        }
    });
}

function drawTrajectory() {
    if (!gameState.isDragging) return;

    const dx = SLINGSHOT_X - gameState.dragStart.x;
    const dy = SLINGSHOT_Y - gameState.dragStart.y;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    ctx.beginPath();
    let x = SLINGSHOT_X;
    let y = SLINGSHOT_Y;
    let vx = dx * 0.25;
    let vy = dy * 0.25;

    for (let i = 0; i < 50; i++) {
        ctx.lineTo(x, y);
        vx *= 0.985; // Minimal air resistance
        vy += GRAVITY * PIG_TYPES[gameState.currentPigType].mass;
        x += vx;
        y += vy;

        if (y >= GROUND_Y) break;
    }

    ctx.stroke();
    ctx.setLineDash([]);
}

function drawUI() {
    // UI removed - info now in header
}

// Game Loop
function gameLoop() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw everything
    drawBackground();
    drawClouds();
    drawGround();
    drawSlingshot();
    drawStructures();
    drawBirds();
    drawTrajectory();
    drawUI();

    // Update and draw pig
    if (gameState.launchedPig) {
        gameState.launchedPig.update();
        gameState.launchedPig.draw();

        // Check if pig is done
        if (!gameState.launchedPig.active) {
            gameState.launchedPig = null;
            gameState.abilityUsed = false;
        }
    }

    // Update and draw small pigs from splitter
    if (gameState.smallPigs && gameState.smallPigs.length > 0) {
        gameState.smallPigs = gameState.smallPigs.filter(pig => {
            if (pig.active) {
                pig.update();
                pig.draw();
                return true;
            }
            return false;
        });
    }

    // Check win/lose conditions only when no pigs are active AND game has started
    const noPigsActive = !gameState.launchedPig && 
                        (!gameState.smallPigs || gameState.smallPigs.length === 0);

    if (noPigsActive && gameState.gameStarted && !gameState.checkingWinCondition) {
        // Check win condition
        if (gameState.birds.length === 0) {
            gameState.checkingWinCondition = true;
            setTimeout(() => {
                showLevelComplete();
                const userId = getCookie('userId')|| sessionStorage.getItem('userId');
                // DISCUSS MAKING SLICE WORLD ENDGAMES COUNT AS TOTAL GAMES
                //socket.emit('add-totalgames', userId);
                socket.emit('leaderboard-update',({
                    userId: userId,
                    gameType: 'pigLaunch',
                    score: gameState.score
                }));
            }, 1000);
        } else if (gameState.pigsRemaining === 0) {
            gameState.checkingWinCondition = true;
            setTimeout(() => {
                showGameOver();
                const userId = getCookie('userId')|| sessionStorage.getItem('userId');
                // DISCUSS MAKING SLICE WORLD ENDGAMES COUNT AS TOTAL GAMES
                //socket.emit('add-totalgames', userId);
                socket.emit('leaderboard-update',({
                    userId: userId,
                    gameType: 'pigLaunch',
                    score: gameState.score
                }));
            }, 1000);
        }
    }

    // Update and draw particles
    gameState.particles = gameState.particles.filter(p => {
        p.update();
        p.draw();
        return p.life > 0;
    });

    requestAnimationFrame(gameLoop);
}

// Mouse Events
canvas.addEventListener('mousedown', handleStart);
canvas.addEventListener('mousemove', handleMove);
canvas.addEventListener('mouseup', handleEnd);

// Touch Events for Mobile
canvas.addEventListener('touchstart', handleStart);
canvas.addEventListener('touchmove', handleMove);
canvas.addEventListener('touchend', handleEnd);

function handleStart(e) {
    e.preventDefault();

    if (gameState.launchedPig) {
        // Activate ability
        gameState.launchedPig.activateAbility();
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    const y = (touch.clientY - rect.top) * (canvas.height / rect.height);

    const dx = x - SLINGSHOT_X;
    const dy = y - SLINGSHOT_Y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 50 && !gameState.launchedPig) {
        gameState.isDragging = true;
        gameState.dragStart = { x, y };
    }
}

function handleMove(e) {
    if (!gameState.isDragging) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    let x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    let y = (touch.clientY - rect.top) * (canvas.height / rect.height);

    // Limit drag distance
    const dx = x - SLINGSHOT_X;
    const dy = y - SLINGSHOT_Y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > MAX_PULL) {
        const angle = Math.atan2(dy, dx);
        x = SLINGSHOT_X + Math.cos(angle) * MAX_PULL;
        y = SLINGSHOT_Y + Math.sin(angle) * MAX_PULL;
    }

    gameState.dragStart = { x, y };
}

function handleEnd(e) {
    if (!gameState.isDragging) return;
    e.preventDefault();

    gameState.isDragging = false;

    const dx = SLINGSHOT_X - gameState.dragStart.x;
    const dy = SLINGSHOT_Y - gameState.dragStart.y;

    // Launch pig with higher power but add air resistance for slower travel
    const pig = new Pig(SLINGSHOT_X, SLINGSHOT_Y, gameState.currentPigType);
    pig.vx = dx * 0.25;
    pig.vy = dy * 0.25;

    gameState.launchedPig = pig;
    gameState.pigsRemaining--;
    gameState.gameStarted = true; // Mark game as started when first pig is launched
}

// Keyboard Events
document.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
        restartLevel();
    }
});

// Pig Selection
document.querySelectorAll('.pig-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (gameState.launchedPig) return;

        document.querySelectorAll('.pig-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.currentPigType = btn.dataset.pig;
    });
});

// Level Functions
function showLevelComplete() {
    // Start with 200 points base, each pig used costs 10 points
    const pigsUsed = 5 - gameState.pigsRemaining;
    const levelScore = 200 - (pigsUsed * 10);

    // Replace the score with the level start score plus new level score
    gameState.score = gameState.scoreAtLevelStart + levelScore;

    // Check if this was the last level
    if (gameState.level >= LEVELS.length) {
        showVictory();
    } else {
        // Show only the level score in the modal
        document.getElementById('modalScore').textContent = levelScore;
        // Update the total score in the header
        document.getElementById('score').textContent = gameState.score;
        document.getElementById('levelCompleteModal').style.display = 'flex';
    }
}

function showVictory() {
    document.getElementById('victoryScore').textContent = gameState.score;
    document.getElementById('victoryModal').style.display = 'flex';
}

function showGameOver() {
    // Reset score to what it was before this level (0 points for failing)
    gameState.score = gameState.scoreAtLevelStart;
    document.getElementById('gameOverScore').textContent = gameState.score;
    document.getElementById('gameOverModal').style.display = 'flex';
}

function nextLevel() {
    document.getElementById('levelCompleteModal').style.display = 'none';
    gameState.level++;
    initLevel(gameState.level);
}

function restartLevel() {
    document.getElementById('levelCompleteModal').style.display = 'none';
    document.getElementById('gameOverModal').style.display = 'none';
    // Reset score to what it was before this level started
    gameState.score = gameState.scoreAtLevelStart;
    initLevel(gameState.level);
}

function playAgain() {
    document.getElementById('victoryModal').style.display = 'none';
    gameState.level = 1;
    gameState.score = 0;
    initLevel(1);
}

// Window Resize
window.addEventListener('resize', () => {
    const oldGroundY = GROUND_Y;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 80;

    // Update ground position
    GROUND_Y = canvas.height - 50;
    SLINGSHOT_Y = GROUND_Y - 50;

    // Adjust structure and bird positions
    gameState.structures.forEach(s => {
        const heightFromGround = oldGroundY - s.y;
        s.y = GROUND_Y - heightFromGround;
    });
    gameState.birds.forEach(b => {
        const heightFromGround = oldGroundY - b.y;
        b.y = GROUND_Y - heightFromGround;
    });
});

// Wait for DOM to be fully loaded
window.addEventListener('load', () => {
    // Ensure canvas size is set correctly
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 80;

    // Update game constants based on actual canvas size
    GROUND_Y = canvas.height - 50;
    SLINGSHOT_Y = GROUND_Y - 50;

    console.log('Canvas initialized:', canvas.width, 'x', canvas.height);
    console.log('Ground Y:', GROUND_Y);

    // Start Game
    initLevel(1);
    gameLoop();
});
export { nextLevel, restartLevel, playAgain };
