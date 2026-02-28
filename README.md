# Gesture Shooter MVP

2-player webcam + Three.js gesture shooter with Socket.IO server authority.

## Requirements
- Node.js 20+
- npm 10+

## Setup
```bash
cd server
npm install

cd ../client
npm install
npm run setup:mediapipe
```

## Run locally
Terminal 1:
```bash
cd server
npm run dev
```

Terminal 2:
```bash
cd client
npm run dev
```

Open `http://localhost:5173`.

## Security-relevant environment variables
- `CORS_ORIGINS`: comma-separated allowlist of browser origins that can call the API/socket.
  - Example: `CORS_ORIGINS=https://game.example.com,https://staging.example.com`
  - For local dev, defaults allow `localhost:5173`, `127.0.0.1:5173`, `localhost:4173`, `127.0.0.1:4173`.

## LAN demo
1. Start server on Laptop A (`npm run dev` in `/server`).
2. Find Laptop A IP (for example `192.168.1.42`).
3. On both clients set:
```bash
VITE_SERVER_URL=http://192.168.1.42:3001 npm run dev
```
4. Create room on one laptop and join from the other.
5. Host clicks `Start Match` from the waiting room.

## Tests
```bash
cd server
npm test
```

## Input modes
- `Hand`: MediaPipe hand tracking with pinch shoot.
- `Mouse`: Manual fallback mode using pointer aim + click shoot.
