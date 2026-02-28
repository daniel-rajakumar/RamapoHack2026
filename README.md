# Gesture Shooter (Next.js Full-Stack)

2-player webcam + Three.js gesture shooter running as a single Next.js app with Socket.IO server authority.

## Requirements
- Node.js 20+
- npm 10+

## Setup
```bash
npm install
npm run setup:mediapipe
```

## Run locally
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables
- `PORT`: server port (default `3000`)
- `HOST`: bind host (default `0.0.0.0`)
- `CORS_ORIGINS`: comma-separated allowlist for browser origins hitting Socket.IO.
  - Example: `CORS_ORIGINS=https://game.example.com,https://staging.example.com`
  - Defaults include localhost ports (`3000`, `4173`, `5173`) for local development.
- `NEXT_PUBLIC_SERVER_URL` (optional): explicit socket target URL for client.
  - Leave unset for same-origin operation.

## Build and start
```bash
npm run build
npm run start
```

## Docker
```bash
docker build -t gesture-shooter .
docker run --rm -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e CORS_ORIGINS=http://localhost:3000 \
  gesture-shooter
```

## Render
This repo includes [render.yaml](/Users/danielrajakumar/code/RamapoHack2026/render.yaml) for Blueprint deploy.

Required env var on Render:
- `CORS_ORIGINS=https://<your-render-domain>`

## Input modes
- `Hand`: MediaPipe hand tracking with pinch shoot.
- `Mouse`: Manual fallback mode using pointer aim + click shoot.
