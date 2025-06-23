import type { BunFile } from "bun";

export interface StorageAdapter {
  /** Uploads a file and returns its hash. */
  upload(fileKey: string, file: Blob): Promise<{ fileHash: string }>;

  /** Returns a stream or BunFile for downloading. */
  getDownloadObject(fileKey: string): Promise<BunFile>;

  /** Deletes a file from storage. */
  delete(fileKey: string): Promise<void>;

  /** Generates a temporary, signed URL for private files. */
  getSignedUrl(fileKey: string, expiresIn: number): Promise<string>;

  /** Gets the permanent public URL for a public file. */
  getPublicUrl(fileKey: string): string;
}
