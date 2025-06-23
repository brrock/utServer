import type { BunFile } from "bun";
import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import type { StorageAdapter } from "./adapter";
import { parseTimeToSeconds, type Time } from "../lib/utils";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
await fs.mkdir(UPLOADS_DIR, { recursive: true });

export class LocalStorageAdapter implements StorageAdapter {
  private baseUrl: string;
  private apiSecret: string;

  constructor(baseUrl: string, apiSecret: string) {
    this.baseUrl = baseUrl;
    this.apiSecret = apiSecret;
  }

  async upload(fileKey: string, file: Blob): Promise<{ fileHash: string }> {
    const filePath = path.join(UPLOADS_DIR, fileKey);
    const buffer = await file.arrayBuffer();

    await Bun.write(filePath, buffer);

    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(buffer);
    const fileHash = hasher.digest("hex");

    return { fileHash };
  }

  async getDownloadObject(fileKey: string): Promise<BunFile> {
    const filePath = path.join(UPLOADS_DIR, fileKey);
    return Bun.file(filePath);
  }

  async delete(fileKey: string): Promise<void> {
    try {
      const filePath = path.join(UPLOADS_DIR, fileKey);
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        console.error(`Failed to delete file ${fileKey}:`, error);
      }
    }
  }

  getPublicUrl(fileKey: string): string {
    return `${this.baseUrl}/f/${fileKey}`;
  }

  async getSignedUrl(
    fileKey: string,
    expiresIn: number | Time,
    data?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<string> {
    const signaturePrefix = "hmac-sha256=";
    const algorithm = { name: "HMAC", hash: "SHA-256" };
    const toHex = (buffer: Uint8Array) =>
      Array.prototype.map
        .call(buffer, (x: number) => `00${x.toString(16)}`.slice(-2))
        .join("");
    const encoder = new TextEncoder();
    const ttlInSeconds = parseTimeToSeconds(expiresIn);

    if (isNaN(ttlInSeconds) || ttlInSeconds <= 0) {
      throw new Error(
        "Invalid expiresIn: must be a positive number of seconds or a valid time string.",
      );
    }
    if (ttlInSeconds > 86400 * 7) {
      throw new Error("expiresIn must be less than 7 days (604800 seconds).");
    }

    const urlBase = `${this.baseUrl}/f/${fileKey}`;
    const parsedURL = new URL(urlBase);

    const expirationTimestampMs = Date.now() + ttlInSeconds * 1000;
    parsedURL.searchParams.append("expires", expirationTimestampMs.toString());

    if (data) {
      Object.entries(data).forEach(([key, value]) => {
        if (value == null) return;
        parsedURL.searchParams.append(key, encodeURIComponent(String(value)));
      });
    }

    const payloadForSigning = parsedURL.toString();

    let signature: string;
    try {
      const signingKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(this.apiSecret),
        algorithm,
        false,
        ["sign"],
      );

      const signatureArrayBuffer = await crypto.subtle.sign(
        algorithm,
        signingKey,
        encoder.encode(payloadForSigning),
      );

      const signatureHex = toHex(new Uint8Array(signatureArrayBuffer));

      signature = `${signaturePrefix}${signatureHex}`;
    } catch (e) {
      throw new Error(
        `Failed to generate URL signature: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    parsedURL.searchParams.append("signature", signature);

    return parsedURL.href;
  }
}
