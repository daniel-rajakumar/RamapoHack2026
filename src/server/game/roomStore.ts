import { MATCH_DURATION_MS, ROOM_CODE_CHARS, ROOM_CODE_LENGTH } from "./config";
import type { PlayerView, Room } from "./types";
import { createInitialTargets } from "./targets";

function generateRoomCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      const index = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
      code += ROOM_CODE_CHARS[index];
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("Unable to generate unique room code");
}

export function toPlayerViews(room: Room): PlayerView[] {
  return Array.from(room.players.values()).map(({ id, name, score }) => ({ id, name, score }));
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();

  private readonly socketToRoomCode = new Map<string, string>();

  createRoom(hostSocketId: string, hostName: string): Room {
    const roomCode = generateRoomCode(new Set(this.rooms.keys()));
    const room: Room = {
      roomCode,
      hostSocketId,
      players: new Map([[hostSocketId, { id: hostSocketId, name: hostName, score: 0 }]]),
      started: false,
      startTime: 0,
      durationMs: MATCH_DURATION_MS,
      twoGuns: false,
      targets: createInitialTargets(0, 0),
      nextTargetId: 1,
      lastShotAtByPlayer: new Map(),
      shotWindowCountByPlayer: new Map(),
      aimByPlayer: new Map([[hostSocketId, { x: 0.5, y: 0.5 }]]),
      pendingShots: []
    };

    this.rooms.set(roomCode, room);
    this.socketToRoomCode.set(hostSocketId, roomCode);

    return room;
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  getRoomBySocketId(socketId: string): Room | undefined {
    const roomCode = this.socketToRoomCode.get(socketId);
    if (!roomCode) {
      return undefined;
    }
    return this.rooms.get(roomCode);
  }

  joinRoom(roomCode: string, socketId: string, name: string): { ok: true; room: Room } | { ok: false } {
    const room = this.rooms.get(roomCode);
    if (!room || room.players.size >= 2 || room.players.has(socketId)) {
      return { ok: false };
    }

    room.players.set(socketId, { id: socketId, name, score: 0 });
    room.aimByPlayer.set(socketId, { x: 0.5, y: 0.5 });
    this.socketToRoomCode.set(socketId, roomCode);
    return { ok: true, room };
  }

  removeSocket(socketId: string): Room | undefined {
    const roomCode = this.socketToRoomCode.get(socketId);
    if (!roomCode) {
      return undefined;
    }

    this.socketToRoomCode.delete(socketId);
    const room = this.rooms.get(roomCode);
    if (!room) {
      return undefined;
    }

    room.players.delete(socketId);
    room.lastShotAtByPlayer.delete(socketId);
    room.shotWindowCountByPlayer.delete(socketId);
    room.aimByPlayer.delete(socketId);
    room.pendingShots = room.pendingShots.filter((shot) => shot.shooterId !== socketId);

    if (room.hostSocketId === socketId) {
      const nextHost = room.players.keys().next().value;
      room.hostSocketId = nextHost ?? "";
    }

    return room;
  }

  deleteRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return;
    }

    for (const socketId of room.players.keys()) {
      this.socketToRoomCode.delete(socketId);
    }

    this.rooms.delete(roomCode);
  }

  resetScores(room: Room): void {
    for (const player of room.players.values()) {
      player.score = 0;
    }
    room.lastShotAtByPlayer.clear();
    room.shotWindowCountByPlayer.clear();
    for (const playerId of room.players.keys()) {
      room.aimByPlayer.set(playerId, { x: 0.5, y: 0.5 });
    }
    room.pendingShots = [];
  }
}
