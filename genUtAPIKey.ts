import z from "zod";
import { APP_ID, BASE_URL, API_SECRET } from "lib/constants";
const ConfigSchema = z.object({
  apiKey: z.string(),
  appId: z.string(),
  regions: z.array(z.string()),
  ingestHost: z.string(),
});
type Config = z.infer<typeof ConfigSchema>;

/**
 * Reads API_SECRET from env, validates it, and
 * encodes the config to Base64.
 */
export function encodeConfigToBase64(): string {
  if (!API_SECRET) {
    throw new Error("Missing API_SECRET in environment variables");
  }
  if (!API_SECRET.startsWith("sk_")) {
    throw new Error('API_SECRET must start with "sk_"');
  }
  // even though the ingets url doesn't do anything as it handled by another env variable in the ut app
  const config: Config = {
    apiKey: API_SECRET,
    appId: APP_ID,
    regions: ["us-east-1"],
    ingestHost: BASE_URL,
  };
  const jsonString = JSON.stringify(config);
  return Buffer.from(jsonString).toString("base64");
}
try {
  const base64 = encodeConfigToBase64();
  console.log("Here is your uploadthing token");
  console.log(base64);
} catch (err) {
  console.error(err);
  process.exit(1);
}
