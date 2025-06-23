import { z } from "zod";

export const UploadFilesRequestSchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      type: z.string(),
      customId: z.string().optional(),
    }),
  ),
  metadata: z.record(z.any()).optional(),
  acl: z.enum(["public-read", "private"]).optional().default("private"),
  contentDisposition: z
    .enum(["inline", "attachment"])
    .optional()
    .default("inline"),
});
export const DeleteFilesRequestSchema = z
  .object({
    fileKeys: z.array(z.string()).optional(),
    customIds: z.array(z.string()).optional(),
  })
  .refine((data) => data.fileKeys || data.customIds);
export const ListFilesRequestSchema = z.object({
  limit: z.number().optional().default(20),
  offset: z.number().optional().default(0),
});
export const RenameFileUpdateSchema = z
  .object({
    fileKey: z.string().optional(),
    customId: z.string().optional(),
    newName: z.string(),
  })
  .refine((data) => data.fileKey || data.customId);
export const RenameFilesRequestSchema = z.object({
  updates: z.array(RenameFileUpdateSchema),
});
export const GetSignedUrlRequestSchema = z
  .object({
    fileKey: z.string().optional(),
    customId: z.string().optional(),
    expiresIn: z.number().optional().default(3600),
  })
  .refine((data) => data.fileKey || data.customId);
export const UpdateAclUpdateSchema = z
  .object({
    fileKey: z.string().optional(),
    customId: z.string().optional(),
    acl: z.enum(["public-read", "private"]),
  })
  .refine((data) => data.fileKey || data.customId);
export const UpdateAclRequestSchema = z.object({
  updates: z.array(UpdateAclUpdateSchema),
});


export const IngestQuerySchema = z.object({
  signature: z.string(),
  expires: z.string(),
  "x-ut-identifier": z.string(),
  "x-ut-file-name": z.string(),
  "x-ut-file-size": z.string(),
  "x-ut-file-type": z.string(),
  "x-ut-slug": z.string(),
  "x-ut-content-disposition": z.string(),
  "x-ut-acl": z.string(),
});
const UrlWithOverridesSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  customId: z.string().optional(),
});

export const UploadFilesFromUrlRequestSchema = z.object({
  urls: z.array(z.union([z.string().url(), UrlWithOverridesSchema])),
  metadata: z.record(z.any()).optional(),
  acl: z.enum(["public-read", "private"]).optional(),
  contentDisposition: z.enum(["inline", "attachment"]).optional(),
});

export const DirectUploadRequestSchema = z.object({
  files: z.array(
    z.object({
      name: z.string().max(1024),
      size: z.number().min(0),
      type: z.string(),
      customId: z.string().max(128).optional().nullable(),
    }),
  ),
  acl: z.enum(["public-read", "private"]).optional(),
  metadata: z.record(z.any()).optional().nullable(),
  contentDisposition: z.enum(["inline", "attachment"]).default("inline"),
});


export const CompleteMultipartRequestSchema = z.object({
  fileKey: z.string(),
  uploadId: z.string(),
  etags: z.array(
    z.object({
      tag: z.string(),
      partNumber: z.number(),
    }),
  ),
});


export const FailureCallbackRequestSchema = z.object({
  fileKey: z.string().max(300),
  uploadId: z.string().optional().nullable(),
});


export const ServerCallbackRequestSchema = z.object({
  fileKey: z.string().max(300),
  callbackData: z.record(z.any()).optional().nullable(),
});


export const PrepareUploadV7RequestSchema = z.object({
  fileName: z.string(),
  fileSize: z.number(),
  slug: z.string().optional(),
  fileType: z.string().optional(),
  customId: z.string().optional(),
  contentDisposition: z.enum(["inline", "attachment"]).optional(),
  acl: z.enum(["public-read", "private"]).optional(),
  expiresIn: z.number().default(3600),
});

export const RouteMetadataRequestSchema = z.object({
  fileKeys: z.array(z.string()),
  metadata: z.record(z.any()).optional().nullable(),
  isDev: z.boolean().optional().default(false),
  callbackUrl: z.string().url(),
  callbackSlug: z.string(),
  awaitServerData: z.boolean().optional().default(true),
});