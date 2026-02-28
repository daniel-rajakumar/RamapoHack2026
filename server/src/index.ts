import http from "node:http";
import { pathToFileURL } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { HOST, PORT } from "./config.js";
import { RoomStore } from "./roomStore.js";
import { allowSocketRequest, corsOriginCheck } from "./security.js";
import { setupSocketHandlers } from "./socketHandlers.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./types.js";

export function createGameServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(
    cors({
      origin: corsOriginCheck,
      methods: ["GET", "POST"],
      optionsSuccessStatus: 204
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const httpServer = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: corsOriginCheck,
      methods: ["GET", "POST"]
    },
    allowRequest: allowSocketRequest
  });

  const roomStore = new RoomStore();
  setupSocketHandlers(io, roomStore);

  async function start(port = PORT, host = HOST): Promise<number> {
    await new Promise<void>((resolve) => {
      httpServer.listen(port, host, () => resolve());
    });
    const address = httpServer.address();
    if (typeof address === "object" && address && "port" in address) {
      return address.port;
    }
    return port;
  }

  async function stop(): Promise<void> {
    io.close();
    await new Promise<void>((resolve, reject) => {
      if (!httpServer.listening) {
        resolve();
        return;
      }
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return { app, io, httpServer, roomStore, start, stop };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = createGameServer();
  server
    .start()
    .then((port) => {
      // eslint-disable-next-line no-console
      console.log(`Server listening on http://${HOST}:${port}`);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Failed to start server", error);
      process.exitCode = 1;
    });
}
