# 🕹️ GAMEHUB

GAMEHUB is a modular, full-stack game platform supporting multiplayer experiences, AI simulations, and real-time chat. Built with scalability and maintainability in mind, it features a clean separation between frontend and backend logic, Prisma ORM for database management, and sprint-based development documentation.

---

## 📁 Project Structure

```
GAMEHUB/
├── .vscode/                          # VSCode workspace settings
├── BackEnd/                          # Server-side logic
│   ├── AI/                           # AI modules and simulations
│   │   └── drop4.js
│   └── games/                        # Game-specific backend logic
│       ├── drop4/
│       │   └── index.js
│       ├── sinkEm/
│       │   └── index.js
│       │   ├── index.js
│       │   ├── server.js
│       │   ├── simulate_battleship_test.js
│       │   └── test_drop4.js
├── FrontEnd/                         # Client-side UI and game logic
│   ├── ai/
│   │   └── connect4Agent.js
│   ├── Assets/                       # Static assets
│   │   ├── GHCCoin.png
│   │   ├── GHRBCoin.png
│   │   ├── styles.css
│   │   └── theme.js
│   ├── games/
│   │   ├── commonLogic/              # Shared frontend logic
│   │   │   ├── chat.js
│   │   │   ├── cookie.js
│   │   │   ├── socket.js
│   │   │   └── ui.js
│   │   ├── drop4/
│   │   │   ├── drop4.html
│   │   │   ├── drop4JoinGame.html
│   │   │   ├── drop4Leaderboard.html
│   │   │   ├── drop4logic.js
│   │   │   ├── drop4Menu.html
│   │   │   ├── drop4SinglePlayer.html
│   │   │   └── game.js
│   │   ├── pigLaunch/
│   │   │   ├── pigLaunch.html
│   │   │   ├── pigLaunchLeaderboard.html
│   │   │   ├── pigLaunchLogic.js
│   │   │   └── pigLaunchMenu.html
│   │   ├── sinkEm/
│   │   │   ├── game.js
│   │   │   ├── sinkEmJoinGame.html
│   │   │   ├── sinkEmLeaderboard.html
│   │   │   ├── sinkEmLogic.js
│   │   │   └── sinkEmMenu.html
│   │   └── sliceWorld/
│   │       ├── assets/
│   │       │   ├── alien.png
│   │       │   ├── earth_vector.png
│   │       │   ├── neptune.png
│   │       │   ├── Portrait_Placeholder.png
│   │       │   ├── reactor.png
│   │       │   └── saturn.png
│   │       ├── game.js
│   │       ├── sliceWorld.css
│   │       ├── sliceWorld.html
│   │       ├── sliceWorldLeaderboard.html
│   │       ├── sliceWorldLogic.js
│   │       └── sliceWorldMenu.html
├── login-signup/                     # Authentication UI
│   ├── index.html
│   ├── login.html
│   └── signUp.html
├── Profile/                          # User profile pages
│   ├── profile.html
│   └── settings.html
├── streamChat/                       # Real-time chat interface
│   ├── chat-entry.js
│   ├── stream-chat.bundle.js
│   └── homepage.html
├── node_modules/                     # Node.js dependencies
├── prisma/                           # Prisma ORM setup
│   ├── schema.prisma
│   ├── Scripts/
│   └── migrations/
├── Sprints/                          # Development documentation
│   ├── docs/
│   │   ├── ARCHITECTURE.md
│   │   ├── Database ERD.png
│   │   └── README.md
│   ├── Sprint 1/
│   │   ├── AI Usage Log Sprint 1.pdf
│   │   ├── Sprint 1 Retrospective.pdf
│   │   └── Sprint 1 Review.pdf
│   ├── Sprint 2/
│   │   ├── Sprint 2 AI log.pdf
│   │   ├── Sprint 2 retrospective.pdf
│   │   └── Sprint 2 Review.pdf
│   └── Sprint3/
│   │   ├── Sprint 3 AI log.pdf
│   │   ├── Sprint 3 retrospective.pdf
│   │   └── Sprint 3 Review.pdf
├── homepage.html                     # Entry point for the frontend
├── .env                              # Environment variables
├── .gitignore                        # Git configuration
├── package.json                      # Project metadata and scripts
├── package-lock.json                 # Dependency lock file
└── vite.config.js                    # Vite bundler configuration
```

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm renderBuild
```

### 2. Set Up Environment

Create a `.env` file based on `.env.example` and configure your database and server settings.

### 3. Run the Backend

```bash
node BackEnd/games/server.js
```

### 4. Run the Frontend

```bash
npm run dev
```

---

## 🧪 Testing

- Backend test files: `simulate_battleship_test.js`, `test_drop4.js`
- Use `node` to run individual test scripts.
- Frontend testing setup TBD (consider integrating Vitest or Jest).

---

## 🧠 AI Integration

- Backend AI logic lives in `BackEnd/AI`
- Frontend AI interfaces in `FrontEnd/ai`
- Designed for modular expansion across games.

---

## 📦 Database

- Managed via Prisma
- Schema defined in `prisma/schema.prisma`
- Migrations tracked in `prisma/migrations`

---

## 📚 Sprint Documentation

- Iterative development tracked in `Sprints/`
- Each sprint folder contains planning, retrospectives, and feature breakdowns.

---

## 💬 Real-Time Features

- `streamChat` handles socket-based chat
- Backend attendance and presence logic integrated with game sessions

---

## 🛠️ Build Tools

- Vite for fast frontend bundling
- Node.js for backend runtime

