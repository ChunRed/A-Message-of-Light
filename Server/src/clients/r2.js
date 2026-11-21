import crypto from "node:crypto";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getRequiredEnv } from "../env.js";

export const ALLOWED_IMAGE_MIME_TYPES = new Map([
  ["image/webp", "webp"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);

let cachedClient = null;

function getR2Client() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: getRequiredEnv("R2_ENDPOINT"),
      credentials: {
        accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
      },
      // Avoid AWS SDK v3.729+ injecting empty-body CRC32 checksum query params
      // that cause browser PUT uploads to Cloudflare R2 to fail with 400
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return cachedClient;
}

function buildObjectKey(fileName, contentType) {
  const ext = ALLOWED_IMAGE_MIME_TYPES.get(contentType) ?? "bin";
  const parsed = path.parse(String(fileName || "image"));
  const safeBase = parsed.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const datePrefix = new Date().toISOString().slice(0, 10);
  const uniqueId = crypto.randomUUID();
  const suffix = safeBase ? `${uniqueId}-${safeBase}.${ext}` : `${uniqueId}.${ext}`;
  return `uploads/${datePrefix}/${suffix}`;
}

export async function createPresignedUploadUrl({ fileName, contentType }) {
  const bucket = getRequiredEnv("R2_BUCKET_NAME");
  const publicBaseUrl = getRequiredEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
  const key = buildObjectKey(fileName, contentType);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, {
    expiresIn: 120,
  });

  const publicUrl = `${publicBaseUrl}/${key}`;
  return { uploadUrl, key, publicUrl };
}
