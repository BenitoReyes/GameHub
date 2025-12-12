# 🧱 GAMEHUB Architecture Overview

GAMEHUB is a modular, full-stack game platform designed for scalability, maintainability, and real-time multiplayer interaction. It features a clean separation of concerns across backend services, frontend interfaces, AI modules, and database management.

---

## 🧩 Core Components

- **Backend (`BackEnd/`)**
  - `AI/`: Game-specific AI logic and simulations.
  - `games/`: Server logic per game, including socket handling, game state management, and test scripts.

- **Frontend (`FrontEnd/`)**
  - `games/`: Individual game UIs and logic.
  - `commonLogic/`: Shared utilities for chat, cookies, sockets, and UI.
  - `Assets/`: Static assets including images, styles, and themes.
  - `ai/`: Frontend AI agents and interfaces.
  - `login-signup/`, `Profile/`, `streamChat/`: Auth, user profile, and chat interfaces.

- **Database (`prisma/`)**
  - `schema.prisma`: Defines models and relationships.
  - `migrations/`: Tracks schema evolution.

- **Documentation (`Sprints/`)**
  - `docs/`: Architecture, ERD, and README.
  - `Sprint 1–3/`: Planning, retrospectives, and AI usage logs.

---

## 🔄 Data Flow

1. **Client Interaction**
   - Users interact via HTML/CSS/JS interfaces per game.
   - Socket connections managed through `commonLogic/socket.js`.

2. **Game Lifecycle**
   - Game state handled in `BackEnd/games/[game]/server.js`.
   - AI simulations triggered via `BackEnd/AI/[game].js`.

3. **Database Sync**
   - Prisma ORM syncs game state, user data, and leaderboard entries.
   - Queries and mutations defined in `schema.prisma`.

4. **Real-Time Chat**
   - `streamChat/` handles frontend chat UI.
   - Backend socket logic integrated with game sessions.

---

## 🧠 AI Integration

- AI agents (e.g., `connect4Agent.js`) simulate moves and strategies.
- Backend AI modules run simulations and validate logic.
- Designed for plug-and-play expansion across games.

---

## 🛠️ Build & Deployment

- **Frontend**: Bundled with Vite (`vite.config.js`)
- **Backend**: Node.js runtime
- **Environment**: `.env` for secrets and config
- **Package Management**: `package.json`, `package-lock.json`

---

## 📌 Design Principles

- **Modularity**: Each game and feature is isolated for maintainability.
- **Reusability**: Shared logic lives in `commonLogic/` and `Assets/`.
- **Scalability**: Prisma ORM and socket architecture support multiplayer growth.
- **Transparency**: Sprint folders document development decisions.

---

This architecture supports rapid iteration, clean separation of concerns, and extensibility for future games and features.
