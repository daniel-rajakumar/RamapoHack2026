import { describe, expect, it } from "vitest";
import { RoomStore } from "../roomStore.js";

describe("RoomStore", () => {
  it("creates and joins rooms with max 2 players", () => {
    const store = new RoomStore();
    const room = store.createRoom("socket-a", "Alice");

    expect(room.roomCode).toHaveLength(4);
    expect(room.roomCode).toMatch(/^[A-Z]{4}$/);
    expect(room.players.size).toBe(1);

    const joinOk = store.joinRoom(room.roomCode, "socket-b", "Bob");
    expect(joinOk.ok).toBe(true);
    expect(store.getRoom(room.roomCode)?.players.size).toBe(2);

    const joinFail = store.joinRoom(room.roomCode, "socket-c", "Charlie");
    expect(joinFail.ok).toBe(false);
  });

  it("removes sockets and deletes empty room", () => {
    const store = new RoomStore();
    const room = store.createRoom("socket-a", "Alice");
    store.joinRoom(room.roomCode, "socket-b", "Bob");

    const roomAfterFirstLeave = store.removeSocket("socket-a");
    expect(roomAfterFirstLeave).toBeDefined();
    expect(roomAfterFirstLeave?.players.size).toBe(1);

    const roomAfterSecondLeave = store.removeSocket("socket-b");
    expect(roomAfterSecondLeave).toBeDefined();
    expect(roomAfterSecondLeave?.players.size).toBe(0);

    store.deleteRoom(room.roomCode);
    expect(store.getRoom(room.roomCode)).toBeUndefined();
  });
});
