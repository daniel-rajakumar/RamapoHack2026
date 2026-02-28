import type { IncomingMessage } from "node:http";
import { ALLOWED_ORIGINS, ALLOW_ANY_ORIGIN } from "./config";

const allowedOrigins = new Set(
  ALLOWED_ORIGINS
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin))
);
const isProduction = process.env.NODE_ENV === "production";

function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function isLoopbackOrPrivateIpv4(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }

  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const [a, b] = parts.map((part) => Number(part));
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return false;
  }

  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (ALLOW_ANY_ORIGIN) {
    return true;
  }

  // Allow requests without Origin (CLI tests, server-to-server calls).
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  if (!isProduction) {
    try {
      const parsed = new URL(normalizedOrigin);
      if (isLoopbackOrPrivateIpv4(parsed.hostname)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export function corsOriginCheck(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(null, false);
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
