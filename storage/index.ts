import type { StorageAdapter } from "./adapter";
import { LocalStorageAdapter } from "./localStorage";

const provider = Bun.env.STORAGE_PROVIDER || "local";
const baseUrl = Bun.env.BASE_URL!;
const apiSecret = Bun.env.API_SECRET!;

let storageAdapter: StorageAdapter;

switch (provider) {
  case "local":
    storageAdapter = new LocalStorageAdapter(baseUrl, apiSecret);
    break;

  default:
    throw new Error(`Unsupported storage provider: ${provider}`);
}

if (!baseUrl || !apiSecret) {
  throw new Error("BASE_URL and API_SECRET must be set in your .env file.");
}

export { storageAdapter };
