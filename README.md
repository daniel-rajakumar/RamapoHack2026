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
  - Defaults include localhost ports (`3000`, `4173`, `5173`) and Render's own external URL at runtime.
  - In non-production, private/LAN IPv4 origins are also allowed (useful for 2 laptops on the same network).
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
  gesture-shooter
```

## Render
This repo includes [render.yaml](/Users/danielrajakumar/code/RamapoHack2026/render.yaml) for Blueprint deploy.

Deploy directly with:
- [Render Blueprint Deploy](https://render.com/deploy?repo=https://github.com/daniel-rajakumar/RamapoHack2026)

Manual path:
1. In Render, click `New` -> `Blueprint`.
2. Connect `daniel-rajakumar/RamapoHack2026`.
3. Confirm the free `gesture-shooter` web service and deploy.

Optional hardening after deploy:
- Set `CORS_ORIGINS=https://<your-render-domain>` in Render env vars.

## Input modes
- `Hand`: MediaPipe hand tracking with pinch shoot.
- `Mouse`: Manual fallback mode using pointer aim + click shoot.
