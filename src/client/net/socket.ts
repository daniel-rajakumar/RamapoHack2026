import { io, type Socket } from "socket.io-client";
import { SERVER_URL } from "../config";
import type { ClientToServerEvents, ServerToClientEvents } from "../types";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(): GameSocket {
  return io(SERVER_URL, {
    transports: ["websocket", "polling"]
  }) as GameSocket;
}
