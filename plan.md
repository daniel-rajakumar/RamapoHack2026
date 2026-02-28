# MVP Build Plan — 2-Player Webcam + Three.js “AR” Gesture Shooter (Socket.IO)

## 0) MVP Definition (Do NOT expand)
**What must exist by the end:**
- 2 laptops join the same room using a **Room Code**
- Each laptop shows its **own webcam** as background
- **Three.js** overlays 3D targets on top (“video passthrough AR vibe”)
- **Aim**: index fingertip controls crosshair
- **Shoot**: pinch gesture (edge-trigger + cooldown)
- **Server-authoritative**: targets, hit detection, scoring, timer
- 60s match → results screen with winner/tie

**Explicitly NOT included in MVP:**
- WebXR / real AR anchoring
- Streaming webcam video between players
- Powerups, particles, sounds, fancy UI, login
- Complex models/assets (use primitives only)

---

## 1) Tech Stack
### Server
- Node.js
- Express
- Socket.IO

### Client
- Vite + Vanilla JS (or TS)
- Three.js
- MediaPipe Hands (JS)
- Socket.IO client
- WebRTC getUserMedia for webcam background

---

## 2) Repo Layout (Monorepo)
Create:
- `/server`
  - `package.json`
  - `src/index.(js|ts)`
- `/client`
  - `package.json`
  - `vite.config.(js|ts)`
  - `index.html`
  - `src/main.(js|ts)`
  - `src/config.(js|ts)` (single `SERVER_URL`)
  - `src/net/socket.(js|ts)` (socket wiring + events)
  - `src/game/engine.(js|ts)` (Three.js init + render loop)
  - `src/game/targets.(js|ts)` (spawn/update/remove meshes from server state)
  - `src/vision/hands.(js|ts)` (MediaPipe init + aim + pinch detection)
  - `src/ui/ui.(js|ts)` (minimal DOM screens/state)

---

## 3) Multiplayer Protocol (Socket.IO Events)
### Client → Server
- `create_room { name }` → callback `{ roomCode, playerId }`
- `join_room { roomCode, name }` → callback `{ ok, error?, roomCode?, playerId? }`
- `shoot { roomCode, x, y, t }`
  - `x,y` are normalized in `[0..1]`
  - `t` is timestamp for debugging

### Server → Client
- `room_update { roomCode, players:[{id,name,score}] }`
- `match_start { roomCode, startTime, durationMs }`
- `state_update { roomCode, players, targets:[{id,x,y,r}], timeRemainingMs }`
- `shot_result { roomCode, shooterId, hit, hitTargetId? }` (minimal)
- `match_end { roomCode, finalPlayers, winnerId?, tie }`

**Server authority rules**
- Clients do not decide hits or score.
- Only server spawns/updates targets and scores.
- Clients only send `shoot` events with aim coords.

### Event Contracts + Error Codes (Required)
- Validate all inbound payloads before mutating room state.
- Reject invalid events with callback or `error_event { code, message }`.
- Standard error codes:
  - `ROOM_NOT_FOUND`
  - `ROOM_FULL`
  - `NAME_INVALID`
  - `MATCH_NOT_STARTED`
  - `MATCH_ENDED`
  - `INVALID_SHOT`
  - `RATE_LIMITED`
- Event field requirements:
  - `create_room.name`: non-empty string, max 20 chars after trim.
  - `join_room.roomCode`: uppercase string, fixed length (e.g., 6).
  - `join_room.name`: non-empty string, max 20 chars after trim.
  - `shoot.roomCode`: required string matching player room.
  - `shoot.x`, `shoot.y`: finite numbers only; server clamps to `[0..1]`.
  - `shoot.t`: optional number; debugging only, never trusted for gameplay.

---

## 4) Game State Model (Server)
### Room State
- `roomCode`
- `hostSocketId`
- `players: Map<socketId, {name, score}>` (max 2)
- `started: boolean`
- `startTime: number` (ms epoch)
- `durationMs: 60000`
- `targets: Array<{id, x, y, r, alive}>`
- `nextTargetId: number`
- `lastShotAtByPlayer: Map<socketId, number>` (for server cooldown)
- `shotWindowCountByPlayer: Map<socketId, {windowStartMs, count}>` (anti-spam cap)
- `tickIntervalId` / `broadcastIntervalId`

### Target Specs (Normalized)
- x in `[0.15, 0.85]`
- y in `[0.15, 0.85]`
- radius `r ≈ 0.05` (tune if needed)
- Maintain exactly `N=5` active targets during match

### Room Lifecycle + Disconnect Rules
- Before match start:
  - if a player disconnects, keep room open for remaining player.
  - if room becomes empty, delete room immediately.
- During match:
  - if one player disconnects, end match immediately and declare connected player winner by forfeit.
  - emit `match_end { reason: "forfeit", winnerId }`.
- Reconnect policy for MVP:
  - no in-match rejoin; disconnected player must rejoin a new room.
- Always clear timers/intervals on `match_end` and on empty room.

---

## 5) Client UI/UX (Minimal)
### Screens (DOM-based)
1. **Lobby**
   - Name input
   - Create Room button
   - Join Room input + button
   - Status text
2. **Waiting**
   - Room Code displayed
   - Players list (1/2)
3. **Playing**
   - Webcam background
   - Three.js overlay canvas
   - Scoreboard (both players)
   - Timer
   - Crosshair
4. **Results**
   - Winner / Tie text
   - Final scores

No React. Keep UI dumb and stable.

---

## 6) Rendering Design (Client)
### Webcam Layer
- Use `navigator.mediaDevices.getUserMedia({video:true})`
- Render `<video autoplay playsinline>` inside a fixed container.
- Request webcam at `640x480` for stable performance.
- Explicit mirror policy:
  - mirror local video in UI (`transform: scaleX(-1)`) for natural self-view.
  - when mirrored, convert hand x with `aimX = 1 - landmark.x` before gameplay mapping.
  - keep server/world coordinates unmirrored normalized `[0..1]`.

### Three.js Overlay
- `WebGLRenderer({ alpha:true, antialias:true })`
- Canvas overlays video (absolute positioning).
- Use **OrthographicCamera** for easy mapping from normalized coords to scene coords.
- Scene: ambient + directional light
- Targets: primitives (SphereGeometry / RingGeometry)
- Crosshair: small ring mesh

### Coordinate Mapping
- Gameplay uses normalized `x,y` (0..1) everywhere.
- Convert normalized coords to scene coords:
  - Option A: map to NDC-like plane (e.g., `x_scene = (x-0.5)*W`, `y_scene = (0.5-y)*H`)
  - Keep consistent for targets and crosshair.
- Lock this mapping for all clients; never map based on screen pixel aspect alone.

### Render Loop
- One requestAnimationFrame loop to render the scene.
- No React re-renders.

---

## 7) Hand Tracking + Gestures (Client)
### Tracking
- MediaPipe Hands (JS)
- Use:
  - index fingertip landmark `8` for aim
  - thumb tip landmark `4` and index tip `8` for pinch distance

### Aim
- rawAim = landmark 8 `(x,y)` in normalized webcam space
- apply smoothing (exponential):
  - `smooth = smooth + (raw - smooth) * alpha` where alpha ~ 0.2–0.35
- clamp to [0..1]

### Pinch Shoot
- pinchDist = distance(thumbTip, indexTip)
- pinched = `pinchDist < threshold` (start threshold ~0.05)
- edge trigger:
  - fire only when `previousPinched=false` and `pinched=true`
- client cooldown: 250ms

### Shoot Event
- emit `shoot { roomCode, x: smoothX, y: smoothY, t: Date.now() }`

### Tracking Quality (optional but helpful)
- Good if landmarks present within last 500ms
- Poor if not detected for >1000ms
- Display text only (no heavy logic)

---

## 8) Hit Detection (Server)
### On `shoot`
1. Validate:
   - room exists
   - match started
   - shooter is in room
   - timer not ended
   - payload schema valid (`x,y` finite numbers; roomCode string)
2. Apply server cooldown per player (e.g., 200ms).
3. Apply anti-spam cap (e.g., max 8 shots per second per player).
4. Normalize input:
   - `x = clamp(x, 0, 1)`
   - `y = clamp(y, 0, 1)`
5. Hit test:
   - find any alive target where distance(shot, target) <= r
6. If hit:
   - mark target dead immediately
   - increment shooter score
   - spawn a new target to keep `N=5`
   - broadcast:
     - `shot_result(hit=true, hitTargetId)`
     - `state_update` with updated players/targets/time
7. If miss:
   - optionally broadcast `shot_result(hit=false)`

**Important:** marking target dead immediately prevents double scoring.

### Timeout Boundary Rule
- Server processes shots in receive order.
- If `timeRemainingMs <= 0` at shot processing time, shot is rejected.
- This keeps end-of-match behavior deterministic under network jitter.

---

## 9) Match Timer + Authoritative Loop (Server)
- On match start set `startTime = Date.now()`
- `timeRemainingMs = max(0, durationMs - (now - startTime))`
- Use two loops:
  - simulation tick every `100ms` (process queued shots, target maintenance, timeout checks)
  - broadcast every `250ms` (emit `state_update` with players/targets/time)
- Ordering inside each simulation tick:
  1. process pending shots in FIFO order
  2. apply score/target mutations
  3. compute `timeRemainingMs`
  4. if time is 0, end match and tear down loops
- When match ends:
  - set `started=false`
  - compute winner/tie
  - emit `match_end` once
  - clear all intervals
  - if room empty, delete room

---

## 10) Implementation Order (Do exactly in this order)
### Phase A — Networking + Rooms (Server first)
1. Implement server Socket.IO and Express boot.
2. Implement `create_room`, `join_room`, room storage, max 2 players.
3. Broadcast `room_update` on create/join/disconnect.

**Checkpoint A:** two clients join room and see both names.

### Phase B — Match + Targets (Server)
4. Implement match auto-start when players==2.
5. Implement timer (startTime/durationMs).
6. Implement target spawn logic: create 5 targets, broadcast `match_start` and first `state_update`.
7. Implement periodic `state_update` broadcasting.

**Checkpoint B:** both clients receive targets + ticking timer.

### Phase C — Client UI + Socket Wiring
8. Implement client lobby DOM.
9. Implement socket connect + event handlers for `room_update`, `match_start`, `state_update`, `match_end`.
10. Display players + scores + timer in DOM.

**Checkpoint C:** clients show synchronized state updates.

### Phase D — Webcam + Three.js Overlay
11. Add webcam background video.
12. Add Three.js engine overlay canvas.
13. Render targets from server `state_update`.
14. Render crosshair at center by default.

**Checkpoint D:** webcam + 3D targets render smoothly.

### Phase E — Hand Aim + Pinch Shoot
15. Implement server `shoot` pipeline first (validation + cooldown + anti-spam + hit detection).
16. Add MediaPipe Hands tracking.
17. Map index tip to crosshair (with smoothing).
18. Add pinch detection (edge trigger + cooldown).
19. Emit `shoot` events to server.

**Checkpoint E:** pinch sends events and crosshair moves reliably.

### Phase F — Server Hit + Score
20. Verify scoring with simultaneous client shots and timeout boundary cases.
21. On hit: score++ + target respawn + state broadcast.

**Checkpoint F:** scoring works; target disappears and respawns; scores update.

### Phase G — Results Screen
22. Implement `match_end` server event with winner/tie/forfeit reason.
23. Client shows results UI.

**Checkpoint G:** a full 60s match completes and shows winner.

---

## 11) LAN Demo & Configuration
### Requirements
- Client has a single place to configure server URL: `SERVER_URL`
- Provide instructions:
  1. Start server on Laptop A
  2. Find Laptop A LAN IP (e.g., 192.168.x.x)
  3. Set `SERVER_URL = "http://<LAN_IP>:<PORT>"`
  4. Run client on both laptops and open in browser

### Must-have for reliability
- Use 640x480 webcam resolution to reduce lag.
- Make pinch threshold adjustable constant.
- Keep server update interval stable (250–500ms).

---

## 12) Acceptance Tests (Must pass)
1. **Room join**: Laptop A creates room code, laptop B joins, both see 2 players.
2. **Auto-start**: match begins when second player joins.
3. **Render**: webcam background + 3D targets visible on both laptops.
4. **Aim**: crosshair follows finger smoothly without extreme jitter.
5. **Shoot**: pinch triggers one shot per pinch (no spam).
6. **Hit/Score**: hits increase correct shooter score and respawn targets.
7. **End**: at 0 seconds match ends and results show winner/tie.
8. **Disconnect pre-start**: if one player leaves waiting room, remaining player stays in room.
9. **Disconnect in-match**: if one player drops mid-match, match ends with forfeit winner.
10. **Spam defense**: rapid pinch spam does not exceed server cap and does not crash server.
11. **Timeout boundary**: shots arriving at/after timeout do not score.
12. **Simultaneous hit race**: near-simultaneous shots cannot double-score same target.

---

## 13) Definition of Done (MVP)
- All acceptance tests pass on two laptops on same Wi-Fi.
- No console errors.
- No timer/interval leaks after 3 consecutive matches.
- Game can be demoed in under 90 seconds:
  - create room → join → play → results.

---

## 14) Demo Runbook (Failure Fallbacks)
### If camera permission denied
1. Confirm browser permission for camera is allowed.
2. Reload tab once.
3. Fallback: show mouse-controlled crosshair so networking demo can continue.

### If clients cannot connect on LAN
1. Verify server listens on `0.0.0.0` and correct port.
2. Confirm both laptops are on same Wi-Fi.
3. Temporarily disable firewall rules blocking chosen port.
4. Fallback: run both clients on one laptop in two browser windows.

### If tracking quality is poor
1. Increase lighting and move hand closer to camera.
2. Tune pinch threshold constant and smoothing alpha.
3. Fallback: keyboard/mouse shoot mode for final demo continuity.
