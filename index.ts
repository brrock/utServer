import { Hono } from "hono";
import type { Context, Next } from "hono";
import { zValidator } from "@hono/zod-validator";
import { cors } from "hono/cors";
import { prisma } from "lib/db";
import {
  authMiddleware,
  ingestAuthMiddleware,
  requestLoggerMiddleware,
} from "lib/middleware";
import { storageAdapter } from "./storage";
import {
  DeleteFilesRequestSchema,
  GetSignedUrlRequestSchema,
  ListFilesRequestSchema,
  RenameFilesRequestSchema,
  UpdateAclRequestSchema,
  DirectUploadRequestSchema,
  CompleteMultipartRequestSchema,
  FailureCallbackRequestSchema,
  PrepareUploadV7RequestSchema,
  RouteMetadataRequestSchema,
} from "lib/schemas";
import { FileStatus as PrismaFileStatus } from "@prisma/client";
import { logger as HonoLogger } from "hono/logger";
import {
  verifyCdnSignedUrl,
  generateFileKey,
  generateSignedUploadUrl,
} from "lib/utils";
import logger from "lib/logger";
import { API_SECRET, BASE_URL, APP_ID, STORAGE_PROVIDER } from "lib/constants";

const app = new Hono();

if (!API_SECRET || !BASE_URL) {
  throw new Error("API_SECRET and BASE_URL must be set in your .env file.");
}

app.use("*", cors());
app.use("*", HonoLogger());

app.use("*", requestLoggerMiddleware);

app.get("/", (c) => {
  logger.debug("Health check");
  return c.json({ status: "ok", service: "uploadthing-clone" });
});

app.get("/:fileKey", ingestAuthMiddleware, async (c) => {
  const fileKey = c.req.param("fileKey");
  const q = c.req.query();
  logger.log("Pre-flight check for fileKey:", fileKey);
  await prisma.file.upsert({
    where: { key: fileKey },
    create: {
      key: fileKey,
      name: decodeURIComponent(q["x-ut-file-name"] ?? "unknown-file"),
      size: parseInt(q["x-ut-file-size"] ?? "0"),
      type: decodeURIComponent(
        q["x-ut-file-type"] ?? "application/octet-stream",
      ),
      status: "UPLOADING",
      acl: q["x-ut-acl"] === "public-read" ? "PUBLIC_READ" : "PRIVATE",
      contentDisposition:
        q["x-ut-content-disposition"] === "attachment"
          ? "ATTACHMENT"
          : "INLINE",
    },
    update: {},
  });
  return c.text("", 200);
});

app.put("/:fileKey", ingestAuthMiddleware, async (c) => {
  const fileKey = c.req.param("fileKey");
  const q = c.req.query();
  logger.debug("Starting upload for fileKey:", fileKey);
  await prisma.file.upsert({
    where: { key: fileKey },
    create: {
      key: fileKey,
      name: decodeURIComponent(q["x-ut-file-name"] ?? "unknown"),
      size: parseInt(q["x-ut-file-size"] ?? "0", 10),
      type: decodeURIComponent(
        q["x-ut-file-type"] ?? "application/octet-stream",
      ),
      status: "UPLOADING",
      acl: q["x-ut-acl"] === "public-read" ? "PUBLIC_READ" : "PRIVATE",
      contentDisposition:
        q["x-ut-content-disposition"] === "attachment"
          ? "ATTACHMENT"
          : "INLINE",
    },
    update: {},
  });
  const blob = await c.req.blob();
  const { fileHash } = await storageAdapter.upload(fileKey, blob);
  const updated = await prisma.file.update({
    where: { key: fileKey },
    data: { status: "UPLOADED", fileHash, uploadedAt: new Date() },
  });
  logger.log("Upload complete for", fileKey, "hash:", fileHash);
  return c.json({
    ufsUrl: storageAdapter.getPublicUrl(fileKey),
    file: updated,
  });
});

const v6api = new Hono();
v6api.use("*", authMiddleware);

v6api.post(
  "/deleteFiles",
  zValidator("json", DeleteFilesRequestSchema),
  async (c) => {
    const { fileKeys, customIds } = c.req.valid("json");
    logger.log("Deleting files:", { fileKeys, customIds });
    const where = fileKeys
      ? { key: { in: fileKeys } }
      : { customId: { in: customIds! } };
    const filesToDelete = await prisma.file.findMany({ where });
    await Promise.all(
      filesToDelete.map((file) => storageAdapter.delete(file.key)),
    );
    const { count } = await prisma.file.deleteMany({ where });
    logger.debug("Deleted files count:", count);
    return c.json({ success: true, deletedCount: count });
  },
);

v6api.post(
  "/listFiles",
  zValidator("json", ListFilesRequestSchema),
  async (c) => {
    const { limit, offset } = c.req.valid("json");
    logger.log("Listing files", { limit, offset });
    const [files, total] = await Promise.all([
      prisma.file.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.file.count(),
    ]);
    const statusMap: Record<
      PrismaFileStatus,
      "Deletion Pending" | "Failed" | "Uploaded" | "Uploading"
    > = {
      DELETION_PENDING: "Deletion Pending",
      FAILED: "Failed",
      UPLOADED: "Uploaded",
      UPLOADING: "Uploading",
    };
    const formattedFiles = files.map((f) => ({
      id: f.id,
      customId: f.customId,
      key: f.key,
      name: f.name,
      size: f.size,
      status: statusMap[f.status],
      uploadedAt: f.uploadedAt?.getTime() ?? f.createdAt.getTime(),
    }));
    return c.json({
      hasMore: offset + files.length < total,
      files: formattedFiles,
    });
  },
);

v6api.post(
  "/renameFiles",
  zValidator("json", RenameFilesRequestSchema),
  async (c) => {
    const { updates } = c.req.valid("json");
    logger.log("Renaming files:", updates);
    const results = await prisma.$transaction(
      updates.map((u) =>
        prisma.file.updateMany({
          where: u.fileKey ? { key: u.fileKey } : { customId: u.customId! },
          data: { name: u.newName },
        }),
      ),
    );
    const renamedCount = results.reduce((sum, result) => sum + result.count, 0);
    return c.json({ success: true, renamedCount });
  },
);

v6api.post(
  "/requestFileAccess",
  zValidator("json", GetSignedUrlRequestSchema),
  async (c) => {
    const { fileKey, customId, expiresIn } = c.req.valid("json");
    logger.debug("Requesting file access for", { fileKey, customId });
    const file = await prisma.file.findFirstOrThrow({
      where: fileKey ? { key: fileKey } : { customId },
    });
    const url =
      file.acl === "PRIVATE"
        ? await storageAdapter.getSignedUrl(file.key, expiresIn)
        : storageAdapter.getPublicUrl(file.key);
    logger.log("File access URL generated");
    return c.json({ url, ufsUrl: url });
  },
);

v6api.post(
  "/updateACL",
  zValidator("json", UpdateAclRequestSchema),
  async (c) => {
    const { updates } = c.req.valid("json");
    logger.log("Updating ACLs:", updates);
    const results = await prisma.$transaction(
      updates.map((u) =>
        prisma.file.updateMany({
          where: u.fileKey ? { key: u.fileKey } : { customId: u.customId! },
          data: { acl: u.acl === "public-read" ? "PUBLIC_READ" : "PRIVATE" },
        }),
      ),
    );
    const updatedCount = results.reduce((sum, result) => sum + result.count, 0);
    return c.json({ success: true, updatedCount });
  },
);

v6api.get("/pollUpload/:fileKey", async (c) => {
  const fileKey = c.req.param("fileKey");
  logger.log("Polling for upload status of", fileKey);
  const file = await prisma.file.findUnique({ where: { key: fileKey } });
  if (!file) return c.json({ error: "File not found" }, 404);
  const isDone = file.status === "UPLOADED";
  return c.json({
    status: isDone ? "done" : "still working",
    file: isDone
      ? {
          fileKey: file.key,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileUrl: storageAdapter.getPublicUrl(file.key),
          customId: file.customId,
        }
      : null,
    metadata: null,
    callbackData: null,
  });
});

v6api.post(
  "/uploadFiles",
  zValidator("json", DirectUploadRequestSchema),
  async (c) => {
    const { files, acl, contentDisposition } = c.req.valid("json");
    logger.log("Requesting presigned URLs for direct upload", {
      count: files.length,
    });
    const responseData = await Promise.all(
      files.map(async (fileInfo) => {
        const key = generateFileKey();
        const aclValue = acl === "public-read" ? "public-read" : "private";
        const cdValue =
          contentDisposition === "attachment" ? "attachment" : "inline";

        const url = await generateSignedUploadUrl(
          {
            key,
            "x-ut-file-name": fileInfo.name,
            "x-ut-file-size": String(fileInfo.size),
            "x-ut-file-type": fileInfo.type,
            "x-ut-acl": aclValue,
            "x-ut-content-disposition": cdValue,
          },
          3600,
        );

        return {
          key,
          fileName: fileInfo.name,
          fileType: fileInfo.type,
          fileUrl: storageAdapter.getPublicUrl(key),
          url,
          customId: fileInfo.customId,
          contentDisposition,
          pollingJwt: "not-implemented",
          pollingUrl: `${BASE_URL}/v6/pollUpload/${key}`,
          fields: {},
        };
      }),
    );
    return c.json({ data: responseData });
  },
);

v6api.post(
  "/completeMultipart",
  zValidator("json", CompleteMultipartRequestSchema),
  async (c) => {
    const { fileKey } = c.req.valid("json");
    logger.log("Completing multipart upload for", fileKey);
    await prisma.file.update({
      where: { key: fileKey },
      data: { status: "UPLOADED", uploadedAt: new Date() },
    });
    return c.json({ success: true });
  },
);

v6api.post(
  "/failureCallback",
  zValidator("json", FailureCallbackRequestSchema),
  async (c) => {
    const { fileKey, uploadId } = c.req.valid("json");
    logger.error("Received failure callback for", { fileKey, uploadId });
    await prisma.file.update({
      where: { key: fileKey },
      data: { status: "FAILED" },
    });
    return c.json({ success: true });
  },
);

v6api.post("/getUsageInfo", async (c) => {
  logger.log("Requesting usage info");
  const [usage, count] = await Promise.all([
    prisma.file.aggregate({ _sum: { size: true } }),
    prisma.file.count(),
  ]);
  const totalBytes = usage._sum.size ?? 0;
  return c.json({
    totalBytes,
    appTotalBytes: totalBytes,
    filesUploaded: count,
    limitBytes: -1,
  });
});

app.route("/v6", v6api);

const v7api = new Hono();

v7api.use("*", authMiddleware);

v7api.post("/getAppInfo", async (c) => {
  return c.json({
    appId: Bun.env.APP_ID || "self-hosted",
    defaultACL: "private",
    allowACLOverride: true,
  });
});

v7api.post(
  "/prepareUpload",
  zValidator("json", PrepareUploadV7RequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    logger.log("Preparing v7 upload for", body.fileName);
    const key = generateFileKey();
    const url = await generateSignedUploadUrl(
      {
        key,
        "x-ut-file-name": body.fileName,
        "x-ut-file-size": String(body.fileSize),
        "x-ut-file-type": body.fileType ?? "application/octet-stream",
        "x-ut-acl": body.acl ?? "private",
        "x-ut-content-disposition": body.contentDisposition ?? "inline",
      },
      body.expiresIn,
    );
    return c.json({ key, url });
  },
);

app.route("/v7", v7api);
app.post(
  "/route-metadata",
  zValidator("json", RouteMetadataRequestSchema),
  async (c) => {
    const body = c.req.valid("json");
    logger.log("Received route metadata for fileKeys:", body.fileKeys);

    const { count } = await prisma.file.updateMany({
      where: {
        key: { in: body.fileKeys },
      },
      data: {
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        callbackUrl: body.callbackUrl,
        callbackSlug: body.callbackSlug,
      },
    });

    logger.debug(`Updated ${count} file(s) with callback metadata.`);


    return c.json({ ok: true });
  },
);
app.get("/f/:fileKey", async (c) => {
  const fileKey = c.req.param("fileKey");
  logger.log("CDN request for fileKey:", fileKey);
  const file = await prisma.file.findUnique({ where: { key: fileKey } });
  if (!file) {
    logger.error("File not found:", fileKey);
    return c.json({ error: "File not found" }, 404);
  }
  if (file.acl === "PRIVATE") {
    const fullUrl = new URL(c.req.url, BASE_URL).toString();
    if (!verifyCdnSignedUrl(fullUrl, API_SECRET)) {
      logger.error("Invalid or expired signed URL for", fileKey);
      return c.json({ error: "Invalid or expired signed URL" }, 403);
    }
  }
  const downloadObject = await storageAdapter.getDownloadObject(fileKey);
  if (!(await downloadObject.exists())) {
    logger.error("File not in storage:", fileKey);
    return c.json({ error: "File not in storage" }, 404);
  }
  c.header("Content-Type", file.type ?? "application/octet-stream");
  c.header(
    "Content-Disposition",
    `${file.contentDisposition}; filename="${file.name}"`,
  );
  c.header(
    "Cache-Control",
    file.acl === "PRIVATE"
      ? "private, no-store"
      : "public, max-age=31536000, immutable",
  );
  return c.body(downloadObject.stream());
});
app.get("/a/:appID/:fileKey", async (c) => {
  const fileKey = c.req.param("fileKey");
  const appID = c.req.param("appID");
  if (appID !== APP_ID) {
    logger.error("Invalid app ID in request:", appID);
    return c.json({ error: "Invalid app ID" }, 403);
  }
  logger.log("CDN request for fileKey:", fileKey);
  const file = await prisma.file.findUnique({ where: { key: fileKey } });
  if (!file) {
    logger.error("File not found:", fileKey);
    return c.json({ error: "File not found" }, 404);
  }
  if (file.acl === "PRIVATE") {
    const fullUrl = new URL(c.req.url, BASE_URL).toString();
    if (!verifyCdnSignedUrl(fullUrl, API_SECRET)) {
      logger.error("Invalid or expired signed URL for", fileKey);
      return c.json({ error: "Invalid or expired signed URL" }, 403);
    }
  }
  const downloadObject = await storageAdapter.getDownloadObject(fileKey);
  if (!(await downloadObject.exists())) {
    logger.error("File not in storage:", fileKey);
    return c.json({ error: "File not in storage" }, 404);
  }
  c.header("Content-Type", file.type ?? "application/octet-stream");
  c.header(
    "Content-Disposition",
    `${file.contentDisposition}; filename="${file.name}"`,
  );
  c.header(
    "Cache-Control",
    file.acl === "PRIVATE"
      ? "private, no-store"
      : "public, max-age=31536000, immutable",
  );
  return c.body(downloadObject.stream());
});
logger.log(`🚀 Server running on ${BASE_URL}`);
logger.log(`🗄️  Storage provider: ${STORAGE_PROVIDER}`);

export default {
  fetch: app.fetch,
  port: Bun.env.PORT || 3000,
};
