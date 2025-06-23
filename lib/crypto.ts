import * as crypto from "crypto";

export const encoder = new TextEncoder();
export const signaturePrefix = "hmac-sha256=";
export const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
/**
 * Verifies a signature sent from the UploadThing SDK.
 * The SDK signs the *full URL string* (minus the signature param itself).
 *
 * @param requestUrl The full URL of the incoming request.
 * @param secret The API secret key.
 * @returns `true` if the signature is valid.
 */
export async function verifySdkSignature(
  requestUrl: string,
  secret: string
): Promise<boolean> {
  const url = new URL(requestUrl);

  // 1. Extract the signature from the query params
  const rawSig = url.searchParams.get("signature");
  if (!rawSig) return false;

  // 2. Reconstruct the payload string that was signed by the SDK
  // This is the full URL, but with the `&signature=...` part removed.
  url.searchParams.delete("signature");
  const payload = url.toString();

  // 3. Strip the "hmac-sha256=" prefix from the received signature
  let sig = rawSig;
  if (sig.startsWith(signaturePrefix)) {
    sig = sig.substring(signaturePrefix.length);
  }

  // 4. Re-compute the expected signature
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // 5. Decode the client's hex signature
  let sigBytes: Uint8Array;
  try {
    sigBytes = Buffer.from(sig, "hex");
  } catch {
    return false; // Invalid hex
  }

  // 6. Use crypto.subtle.verify for a timing-safe comparison
  return await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    encoder.encode(payload)
  );
}
