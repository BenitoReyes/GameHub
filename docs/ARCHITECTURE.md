```markdown
#  Architecture Overview

##  Game Flow

1. Player connects via Socket.IO.
2. Server assigns role (`red` or `yellow`) and tracks players.
3. Players take turns dropping pieces on the board.
4. Moves are broadcast to the opponent via Socket.IO.
5. Win condition is checked locally and announced.

##  Chat Flow

1. Backend generates StreamChat token using `socket.id` as `userId`.
2. Token and userId are sent to frontend via `chat-auth` event.
3. Frontend connects to StreamChat using `connectUser()`.
4. A `gaming` channel is created or joined.
5. Players can send and receive messages in real-time.

##  Security & Environment

- `.env` file stores API secrets (never committed)
- StreamChat token is generated server-side only
- Frontend receives only the token and userId through requesting get from backend

##  Dependencies

- `express` — initial HTTP server
- `socket.io` — real-time game communication
- `stream-chat` — chat SDK (client + server)
- `dotenv` — environment variable management
- 'Node' - another server for browser testing

##  Testing & CI

- Manual testing via browser

