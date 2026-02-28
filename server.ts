import http from "node:http";
import os from "node:os";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import next from "next";
import { Server } from "socket.io";
import { HOST, PORT } from "./src/server/game/config";
import { RoomStore } from "./src/server/game/roomStore";
import { allowSocketRequest, corsOriginCheck } from "./src/server/game/security";
import { setupSocketHandlers } from "./src/server/game/socketHandlers";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/server/game/types";

function getNetworkHosts(): string[] {
  const hosts = new Set<string>();
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }
      hosts.add(entry.address);
    }
  }

  return [...hosts];
}

async function startServer(): Promise<void> {
  const dev = process.env.NODE_ENV !== "production";
  const nextApp = next({ dev, hostname: HOST, port: PORT });
  const nextHandler = nextApp.getRequestHandler();

  await nextApp.prepare();

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

  app.all("*", (req, res) => {
    void nextHandler(req, res);
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

  await new Promise<void>((resolve) => {
    httpServer.listen(PORT, HOST, () => {
      resolve();
    });
  });

  const networkHosts = getNetworkHosts();

  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Local:   http://localhost:${PORT}`);
  if (networkHosts.length > 0) {
    for (const host of networkHosts) {
      // eslint-disable-next-line no-console
      console.log(`Network: http://${host}:${PORT}`);
    }
  }

  const shutdown = async () => {
    io.close();
    await new Promise<void>((resolve) => {
      if (!httpServer.listening) {
        resolve();
        return;
      }
      httpServer.close(() => resolve());
    });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exitCode = 1;
});
