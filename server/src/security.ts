import type { IncomingMessage } from "node:http";
import { ALLOWED_ORIGINS, ALLOW_ANY_ORIGIN } from "./config.js";

const allowedOrigins = new Set(ALLOWED_ORIGINS);

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (ALLOW_ANY_ORIGIN) {
    return true;
  }

  // Allow requests without Origin (CLI tests, server-to-server calls).
  if (!origin) {
    return true;
  }

  return allowedOrigins.has(origin);
}

export function corsOriginCheck(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Origin not allowed by CORS"));
}

export function allowSocketRequest(
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void
): void {
  const originHeader = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (isAllowedOrigin(originHeader)) {
    callback(undefined, true);
    return;
  }

  callback("Origin not allowed", false);
}
