# Connect Four Online 

A real-time, two-player Connect Four game built with Node.js, Express, Socket.IO, and StreamChat. Players are assigned roles (Red or Yellow) and can compete head-to-head while chatting in-game via a dedicated chat channel.

##  Features

- Real-time multiplayer gameplay using Socket.IO
- Role assignment and turn-based logic
- In-game chat powered by StreamChat (`messaging` channel type)
- Simple UI with Connect Four board and chat interface
- Secure backend token generation for StreamChat authentication

##  Tech Stack

- **Frontend**: HTML, CSS, Vanilla JS
- **Backend**: Node.js, Express, Socket.IO
- **Chat**: StreamChat SDK (client + server)
- **Deployment**: Localhost or cloud platform Render

##  Setup Instructions

1. Clone the repo:
   ```bash
   git clone https://github.com/BenitoReyes/Connect-Four-Online.git
   cd Connect-Four-Online
   
2. Install dependencies:
  npm install

3. Create a .env file in /BackEnd
  STREAM_API_KEY= streamChat_api_key
  STREAM_API_SECRET= streamChat_api_secret

4.  Run the server:
   node BackEnd/server.js

5. Open your browser at:
   http://localhost:3000

Connect-Four-Online/

├── Assets/              # Game piece images

├── BackEnd/             # Express + Socket.IO + StreamChat server

│   └── server.js

├── FrontEnd/            # Game board UI and chat logic 

│   └── index.html

│   └──  script.js       

│   └── styles.css

│   └── streamchat-bundle.js #initializes the browser version of streamchat to the browser 

├── docs/

│   └── README.md

│   └── ARCHITECTURE.md

