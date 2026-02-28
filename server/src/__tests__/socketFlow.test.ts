import { io as createClient, Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameServer } from "../index.js";
import type {
  ClientToServerEvents,
  CreateRoomAck,
  JoinRoomAck,
  MatchEnd,
  StartMatchAck,
  ServerToClientEvents,
  StateUpdate
} from "../types.js";

function waitForEvent<E extends keyof ServerToClientEvents>(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  event: E
) {
  return new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${String(event)}`)), 6000);
    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

describe("socket integration flow", () => {
  const sockets: Array<Socket<ServerToClientEvents, ClientToServerEvents>> = [];
  let stopServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    sockets.length = 0;

    if (stopServer) {
      await stopServer();
      stopServer = undefined;
    }
  });

  it("supports room create/join/start and forfeit end", async () => {
    const server = createGameServer();
    const port = await server.start(0, "127.0.0.1");
    stopServer = server.stop;

    const clientA = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
    const clientB = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
    sockets.push(clientA, clientB);

    await Promise.all([
      new Promise<void>((resolve) => clientA.on("connect", () => resolve())),
      new Promise<void>((resolve) => clientB.on("connect", () => resolve()))
    ]);

    const createAck = await new Promise<CreateRoomAck>((resolve) => {
      clientA.emit("create_room", { name: "Alice" }, (ack: CreateRoomAck) => resolve(ack));
    });

    expect("error" in createAck).toBe(false);
    if ("error" in createAck) {
      throw new Error(`create_room failed: ${createAck.error}`);
    }
    expect(createAck.roomCode).toHaveLength(6);

    const joinAck = await new Promise<JoinRoomAck>((resolve) => {
      clientB.emit("join_room", { roomCode: createAck.roomCode, name: "Bob" }, (ack: JoinRoomAck) => resolve(ack));
    });

    expect(joinAck.ok).toBe(true);
    if (!joinAck.ok) {
      throw new Error(`join_room failed: ${joinAck.error}`);
    }

    const matchStartPromise = waitForEvent(clientA, "match_start");
    const startAck = await new Promise<StartMatchAck>((resolve) => {
      clientA.emit("start_match", { roomCode: createAck.roomCode }, (ack: StartMatchAck) => resolve(ack));
    });
    expect(startAck.ok).toBe(true);
    if (!startAck.ok) {
      throw new Error(`start_match failed: ${startAck.error}`);
    }

    await matchStartPromise;
    const state = (await waitForEvent(clientA, "state_update")) as StateUpdate;
    expect(state.targets.length).toBeGreaterThan(0);

    clientA.emit("shoot", {
      roomCode: createAck.roomCode,
      x: state.targets[0].x,
      y: state.targets[0].y,
      t: Date.now()
    });

    await waitForEvent(clientA, "shot_result");

    const matchEndPromise = waitForEvent(clientA, "match_end") as Promise<MatchEnd>;
    clientB.disconnect();

    const matchEnd = await matchEndPromise;
    expect(matchEnd.reason).toBe("forfeit");
    expect(matchEnd.winnerId).toBe(clientA.id);
  });
});
