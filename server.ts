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

const MAX_TTS_TEXT_LENGTH = 120;
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

function sanitizeTtsText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TTS_TEXT_LENGTH) {
    return null;
  }

  return text;
}

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
  app.use(
    express.json({
      limit: "16kb"
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/voice/tts", async (req, res) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voiceId) {
      res.status(503).json({ error: "VOICE_NOT_CONFIGURED" });
      return;
    }

    const text = sanitizeTtsText(req.body?.text);
    if (!text) {
      res.status(400).json({ error: "INVALID_TEXT" });
      return;
    }

    try {
      const elevenLabsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey
        },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.75
          }
        })
      });

      if (!elevenLabsResponse.ok) {
        const details = (await elevenLabsResponse.text()).slice(0, 200);
        res.status(502).json({
          error: "ELEVENLABS_UPSTREAM_ERROR",
          details
        });
        return;
      }

      const audioBuffer = Buffer.from(await elevenLabsResponse.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(audioBuffer);
    } catch {
      res.status(502).json({ error: "VOICE_UNAVAILABLE" });
    }
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
