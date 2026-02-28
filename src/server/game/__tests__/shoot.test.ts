import { describe, expect, it } from "vitest";
import { MATCH_DURATION_MS } from "../config.js";
import { processQueuedShot } from "../shoot.js";
import type { Room } from "../types.js";

function makeRoom(): Room {
  return {
    roomCode: "ABC123",
    hostSocketId: "p1",
    players: new Map([
      ["p1", { id: "p1", name: "Player 1", score: 0 }],
      ["p2", { id: "p2", name: "Player 2", score: 0 }]
    ]),
    started: true,
    startTime: 0,
    durationMs: MATCH_DURATION_MS,
    inputMode: "hand",
    targets: [{ id: 1, x: 0.5, y: 0.5, r: 0.1, alive: true }],
    nextTargetId: 2,
    lastShotAtByPlayer: new Map(),
    shotWindowCountByPlayer: new Map(),
    aimByPlayer: new Map([
      ["p1", { x: 0.5, y: 0.5 }],
      ["p2", { x: 0.5, y: 0.5 }]
    ]),
    pendingShots: []
  };
}

describe("processQueuedShot", () => {
  it("scores on hit and respawns target", () => {
    const room = makeRoom();
    const result = processQueuedShot(
      room,
      { shooterId: "p1", x: 0.5, y: 0.5, receivedAt: 1000 },
      1000
    );

    expect(result.accepted).toBe(true);
    expect(result.hit).toBe(true);
    expect(result.hitTargetId).toBe(1);
    expect(room.players.get("p1")?.score).toBe(1);
    expect(room.targets[0].id).toBe(2);
  });

  it("rejects cooldown spam", () => {
    const room = makeRoom();

    const first = processQueuedShot(
      room,
      { shooterId: "p1", x: 0.5, y: 0.5, receivedAt: 1000 },
      1000
    );
    const second = processQueuedShot(
      room,
      { shooterId: "p1", x: 0.5, y: 0.5, receivedAt: 1100 },
      1100
    );

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.errorCode).toBe("RATE_LIMITED");
  });

  it("rejects shots after match timeout boundary", () => {
    const room = makeRoom();

    const result = processQueuedShot(
      room,
      { shooterId: "p1", x: 0.5, y: 0.5, receivedAt: MATCH_DURATION_MS + 1 },
      MATCH_DURATION_MS + 1
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("MATCH_ENDED");
  });

  it("rejects shots before match countdown finishes", () => {
    const room = makeRoom();
    room.startTime = 5_000;

    const result = processQueuedShot(
      room,
      { shooterId: "p1", x: 0.5, y: 0.5, receivedAt: 1_000 },
      1_000
    );

    expect(result.accepted).toBe(false);
    expect(result.errorCode).toBe("MATCH_NOT_STARTED");
  });

});
