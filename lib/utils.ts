import { nanoid } from "nanoid";
import { createHmac, timingSafeEqual } from "crypto";
import { URL } from "url";
import { API_SECRET } from "./constants";
import { encoder, signaturePrefix, toHex } from "./crypto";

export type ApiToken = {
  appId: string;
  apiKey: string;
};

export type TimeUnit = "s" | "m" | "h" | "d" | "w" | "M" | "y";
export type TimeString = `${number}${TimeUnit}`;
export type Time = TimeString | number;

/**
 * Generate a random 24-char file key.
 */
export function generateFileKey(): string {
  return nanoid(24);
}

/**
 * Parse an API token. Supports either:
 *  - a “raw” apiKey (<=64 chars, no dots)
 *  - a base64-encoded JSON string: { appId, apiKey }
 *
 * @returns {appId, apiKey} or null if invalid.
 */
export function parseApiToken(token: string): ApiToken | null {
  if (!token.includes(".") && token.length <= 64) {
    return { appId: "default", apiKey: token };
  }

  let json: string;
  try {
    json = Buffer.from(token, "base64").toString("utf-8");
  } catch {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || typeof parsed.apiKey !== "string") {
    return null;
  }

  return {
    appId: typeof parsed.appId === "string" ? parsed.appId : "default",
    apiKey: parsed.apiKey,
  };
}

/**
 * Simple secret-comparison for API keys.
 */
export function validateApiKey(apiKey: string, secret: string): boolean {
  return apiKey === secret 
}


/**
 * Verifies a signed URL generated with:
 *
 *   const payload = new URL(fullPath, BASE_URL).toString();
 *   const sig     = HMAC_SHA256_HEX(secret, payload);
 *   url.searchParams.append("signature", sig);
 *
 * and with an `expires` param that is a millisecond timestamp.
 *
 * @param  fullUrl  The *exact* URL you signed (including host, path, query)
 * @param  secret   Your API secret
 * @returns boolean true if signature matches & not expired
 */
export function verifyCdnSignedUrl(fullUrl: string, secret: string): boolean {
  try {
    // 1) Parse out everything
    const u = new URL(fullUrl);
    const expires = u.searchParams.get("expires");
    const signature = u.searchParams.get("signature");
    if (!expires || !signature) return false;

    const expiresTs = parseInt(expires, 10);
    if (Number.isNaN(expiresTs) || Date.now() > expiresTs) return false;

    u.searchParams.delete("signature");
    const payload = u.toString();

    const expected = createHmac("sha256", secret).update(payload).digest();

    let incoming = signature;
    if (incoming.includes("=")) {
      incoming = incoming.split("=").pop()!;
    }
    const incomingBuf = Buffer.from(incoming, "hex");

    if (incomingBuf.length !== expected.length) return false;
    return timingSafeEqual(incomingBuf, expected);
  } catch {
    return false;
  }
}

/**
 * Convert a time string (e.g. "5m", "2h") or number into seconds.
 * @throws if the format is invalid.
 */
export function parseTimeToSeconds(time: Time): number {
  if (typeof time === "number") {
    if (!Number.isFinite(time) || time < 0) {
      throw new Error(`Invalid time number: ${time}`);
    }
    return Math.floor(time);
  }

  const match = /^(\d+)([smhdwMy])$/.exec(time);
  if (!match) {
    throw new Error(`Invalid time format: "${time}"`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2] as TimeUnit;

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3_600;
    case "d":
      return value * 86_400;
    case "w":
      return value * 604_800;
    case "M":
      return value * 2_592_000; // ≈30 days
    case "y":
      return value * 31_536_000; // ≈365 days
  }
}
export async function generateSignedUploadUrl(
  params: Record<string, string>,
  expiresIn: number,
): Promise<string> {
  const url = new URL(params.key!);
  const expirationTimestampMs = Date.now() + expiresIn * 1000;
  url.searchParams.set("expires", expirationTimestampMs.toString());

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const payload = url.toString();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  url.searchParams.set("signature", `${signaturePrefix}${toHex(signature)}`);

  return url.toString();
}
