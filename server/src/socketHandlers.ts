import type { Server } from "socket.io";
import type { Socket } from "socket.io";
import { endMatch, clearRoomIntervals, emitStateUpdate, startMatch } from "./matchLoop.js";
import { toPlayerViews, RoomStore } from "./roomStore.js";
import { getTimeRemainingMs } from "./shoot.js";
import type { ClientToServerEvents, ErrorCode, ServerToClientEvents } from "./types.js";
import { normalizeRoomCode, validateName, validateShootPayload } from "./validation.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function emitError(io: IoServer, socketId: string, code: ErrorCode): void {
  io.to(socketId).emit("error_event", {
    code,
    message: code
  });
}

function emitRoomUpdate(io: IoServer, roomCode: string, roomStore: RoomStore): void {
  const room = roomStore.getRoom(roomCode);
  if (!room) {
    return;
  }

  io.to(roomCode).emit("room_update", {
    roomCode,
    players: toPlayerViews(room),
    hostId: room.hostSocketId,
    started: room.started
  });
}

function detachSocketFromCurrentRoom(io: IoServer, roomStore: RoomStore, socket: GameSocket): void {
  const existingRoom = roomStore.getRoomBySocketId(socket.id);
  if (!existingRoom) {
    return;
  }

  socket.leave(existingRoom.roomCode);
  const updatedRoom = roomStore.removeSocket(socket.id);
  if (!updatedRoom) {
    return;
  }

  if (updatedRoom.players.size === 0) {
    clearRoomIntervals(updatedRoom);
    roomStore.deleteRoom(updatedRoom.roomCode);
    return;
  }

  if (updatedRoom.started && updatedRoom.players.size === 1) {
    const winnerId = updatedRoom.players.keys().next().value as string | undefined;
    endMatch(io, updatedRoom, "forfeit", winnerId);
    emitStateUpdate(io, updatedRoom);
  }

  emitRoomUpdate(io, updatedRoom.roomCode, roomStore);
}

export function setupSocketHandlers(io: IoServer, roomStore: RoomStore): void {
  io.on("connection", (socket) => {
    socket.on("create_room", (payload, cb) => {
      const name = validateName(payload?.name);
      if (!name) {
        emitError(io, socket.id, "NAME_INVALID");
        cb?.({ error: "NAME_INVALID" });
        return;
      }

      detachSocketFromCurrentRoom(io, roomStore, socket);
      const room = roomStore.createRoom(socket.id, name);
      socket.join(room.roomCode);
      cb?.({ roomCode: room.roomCode, playerId: socket.id });
      emitRoomUpdate(io, room.roomCode, roomStore);
    });

    socket.on("join_room", (payload, cb) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      const name = validateName(payload?.name);
      if (!roomCode || !name) {
        emitError(io, socket.id, !roomCode ? "ROOM_NOT_FOUND" : "NAME_INVALID");
        cb?.({ ok: false, error: !roomCode ? "ROOM_NOT_FOUND" : "NAME_INVALID" });
        return;
      }

      const room = roomStore.getRoom(roomCode);
      if (!room) {
        emitError(io, socket.id, "ROOM_NOT_FOUND");
        cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      if (room.players.size >= 2 || room.started) {
        emitError(io, socket.id, "ROOM_FULL");
        cb?.({ ok: false, error: "ROOM_FULL" });
        return;
      }

      detachSocketFromCurrentRoom(io, roomStore, socket);
      const joined = roomStore.joinRoom(roomCode, socket.id, name);
      if (!joined.ok) {
        emitError(io, socket.id, "ROOM_FULL");
        cb?.({ ok: false, error: "ROOM_FULL" });
        return;
      }

      socket.join(roomCode);
      cb?.({ ok: true, roomCode, playerId: socket.id });
      emitRoomUpdate(io, roomCode, roomStore);
    });

    socket.on("start_match", (payload, cb) => {
      const roomCode = normalizeRoomCode(payload?.roomCode);
      if (!roomCode) {
        emitError(io, socket.id, "ROOM_NOT_FOUND");
        cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      const room = roomStore.getRoom(roomCode);
      if (!room) {
        emitError(io, socket.id, "ROOM_NOT_FOUND");
        cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      if (!room.players.has(socket.id)) {
        emitError(io, socket.id, "ROOM_NOT_FOUND");
        cb?.({ ok: false, error: "ROOM_NOT_FOUND" });
        return;
      }

      if (room.hostSocketId !== socket.id) {
        emitError(io, socket.id, "NOT_HOST");
        cb?.({ ok: false, error: "NOT_HOST" });
        return;
      }

      if (room.started) {
        emitError(io, socket.id, "MATCH_ALREADY_STARTED");
        cb?.({ ok: false, error: "MATCH_ALREADY_STARTED" });
        return;
      }

      if (room.players.size < 2) {
        emitError(io, socket.id, "NOT_ENOUGH_PLAYERS");
        cb?.({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
        return;
      }

      startMatch(io, room);
      emitRoomUpdate(io, roomCode, roomStore);
      cb?.({ ok: true });
    });

    socket.on("shoot", (payload) => {
      const validation = validateShootPayload(payload);
      if (!validation.ok) {
        emitError(io, socket.id, validation.code);
        return;
      }

      const room = roomStore.getRoom(validation.data.roomCode);
      if (!room) {
        emitError(io, socket.id, "ROOM_NOT_FOUND");
        return;
      }

      if (!room.players.has(socket.id)) {
        emitError(io, socket.id, "ROOM_NOT_FOUND");
        return;
      }

      if (!room.started) {
        emitError(io, socket.id, "MATCH_NOT_STARTED");
        return;
      }

      if (getTimeRemainingMs(room, Date.now()) <= 0) {
        emitError(io, socket.id, "MATCH_ENDED");
        return;
      }

      room.pendingShots.push({
        shooterId: socket.id,
        x: validation.data.x,
        y: validation.data.y,
        receivedAt: Date.now(),
        t: validation.data.t
      });
    });

    socket.on("disconnect", () => {
      const room = roomStore.removeSocket(socket.id);
      if (!room) {
        return;
      }

      if (room.players.size === 0) {
        clearRoomIntervals(room);
        roomStore.deleteRoom(room.roomCode);
        return;
      }

      if (room.started && room.players.size === 1) {
        const winnerId = room.players.keys().next().value as string | undefined;
        endMatch(io, room, "forfeit", winnerId);
        emitStateUpdate(io, room);
      }

      emitRoomUpdate(io, room.roomCode, roomStore);
    });
  });
}
