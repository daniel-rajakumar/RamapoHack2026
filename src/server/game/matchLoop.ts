import type { Server } from "socket.io";
import { BROADCAST_MS, MATCH_START_COUNTDOWN_MS, SIM_TICK_MS, TARGET_COUNT, TWO_GUN_SPREAD } from "./config";
import { processQueuedShot, processQueuedTwoGunShot, getTimeRemainingMs } from "./shoot";
import { createInitialTargets, toTargetViews } from "./targets";
import { toPlayerViews } from "./roomStore";
import type { ClientToServerEvents, Room, ServerToClientEvents } from "./types";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function clearRoomIntervals(room: Room): void {
  if (room.tickIntervalId) {
    clearInterval(room.tickIntervalId);
    room.tickIntervalId = undefined;
  }
  if (room.broadcastIntervalId) {
    clearInterval(room.broadcastIntervalId);
    room.broadcastIntervalId = undefined;
  }
}

export function emitStateUpdate(io: IoServer, room: Room): void {
  const timeRemainingMs = room.started ? getTimeRemainingMs(room, Date.now()) : 0;
  const aims = Array.from(room.players.keys()).map((playerId) => {
    const aim = room.aimByPlayer.get(playerId) ?? { x: 0.5, y: 0.5 };
    return { id: playerId, x: aim.x, y: aim.y };
  });
  io.to(room.roomCode).emit("state_update", {
    roomCode: room.roomCode,
    players: toPlayerViews(room),
    targets: toTargetViews(room.targets),
    aims,
    timeRemainingMs
  });
}

function computeTimeoutResult(room: Room): { winnerId?: string; tie: boolean } {
  const players = toPlayerViews(room);
  if (players.length === 0) {
    return { tie: true };
  }
  if (players.length === 1) {
    return { winnerId: players[0].id, tie: false };
  }

  const [first, second] = [...players].sort((a, b) => b.score - a.score);
  if (first.score === second.score) {
    return { tie: true };
  }
  return { winnerId: first.id, tie: false };
}

export function endMatch(
  io: IoServer,
  room: Room,
  reason: "timeout" | "forfeit",
  winnerId?: string
): void {
  if (!room.started && reason !== "forfeit") {
    return;
  }

  room.started = false;
  clearRoomIntervals(room);

  const finalPlayers = toPlayerViews(room);
  const timeoutResult = reason === "timeout" ? computeTimeoutResult(room) : { tie: false, winnerId };

  io.to(room.roomCode).emit("match_end", {
    roomCode: room.roomCode,
    finalPlayers,
    winnerId: timeoutResult.winnerId,
    tie: timeoutResult.tie,
    reason
  });

  room.pendingShots = [];
  room.targets = [];
}

function runSimulationTick(io: IoServer, room: Room): void {
  if (!room.started) {
    return;
  }
  if (Date.now() < room.startTime) {
    return;
  }

  while (room.pendingShots.length > 0) {
    const shot = room.pendingShots.shift();
    if (!shot) {
      break;
    }

    const now = Date.now();
    const results = room.twoGuns
      ? processQueuedTwoGunShot(room, shot, TWO_GUN_SPREAD, now)
      : [processQueuedShot(room, shot, now)];

    for (const result of results) {
      if (!result.accepted) {
        if (result.errorCode) {
          io.to(result.shooterId).emit("error_event", {
            code: result.errorCode,
            message: `Shot rejected: ${result.errorCode}`
          });
        }
        continue;
      }

      io.to(room.roomCode).emit("shot_result", {
        roomCode: room.roomCode,
        shooterId: result.shooterId,
        hit: result.hit,
        hitTargetId: result.hitTargetId
      });

      if (result.hit) {
        emitStateUpdate(io, room);
      }
    }
  }

  if (getTimeRemainingMs(room, Date.now()) <= 0) {
    endMatch(io, room, "timeout");
  }
}

export function startMatch(io: IoServer, room: Room): void {
  if (room.started) {
    return;
  }

  room.started = true;
  room.startTime = Date.now() + MATCH_START_COUNTDOWN_MS;
  room.targets = createInitialTargets(TARGET_COUNT, room.nextTargetId);
  room.nextTargetId += TARGET_COUNT;

  for (const player of room.players.values()) {
    player.score = 0;
  }
  for (const playerId of room.players.keys()) {
    room.aimByPlayer.set(playerId, { x: 0.5, y: 0.5 });
  }
  room.lastShotAtByPlayer.clear();
  room.shotWindowCountByPlayer.clear();
  room.pendingShots = [];

  io.to(room.roomCode).emit("match_start", {
    roomCode: room.roomCode,
    startTime: room.startTime,
    durationMs: room.durationMs,
    twoGuns: room.twoGuns,
    countdownMs: MATCH_START_COUNTDOWN_MS
  });

  emitStateUpdate(io, room);

  room.tickIntervalId = setInterval(() => runSimulationTick(io, room), SIM_TICK_MS);
  room.broadcastIntervalId = setInterval(() => emitStateUpdate(io, room), BROADCAST_MS);
}
