import type { Context, Next } from "hono";
import { parseApiToken, validateApiKey } from "./utils";
import { verifySdkSignature } from "./crypto";
import logger from "./logger";
import { API_SECRET } from "./constants";

// this is the primary auth middleware for the API
export async function authMiddleware(c: Context, next: Next) {
  if (c.req.path.startsWith("/f/")) {
    return await next();
  }

  const authHeader = c.req.header("x-uploadthing-api-key");
  if (!authHeader) return c.json({ error: "Missing API key" }, 401);

  const tokenData = parseApiToken(authHeader);
  if (!tokenData) return c.json({ error: "Invalid API token format" }, 401);

  if (!validateApiKey(tokenData.apiKey, API_SECRET)) {
    return c.json({ error: "Invalid API key" }, 403);
  }

  c.set("auth", tokenData);
  await next();
}
// used for some signature things in the ingest API
export const ingestAuthMiddleware = async (c: Context, next: Next) => {
  if (!(await verifySdkSignature(c.req.url, API_SECRET))) {
    logger.error("Invalid signature for", c.req.url);
    return c.text("Invalid signature", 403);
  }
  await next();
};
// used for debug
export const requestLoggerMiddleware = (c: Context, next: Next) => {
  logger.debug("Incoming request", c.req.method, c.req.url);
  return next();
};
