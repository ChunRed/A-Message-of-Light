import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getRequiredEnv } from "../env.js";

export const ALLOWED_IMAGE_MIME_TYPES = new Map([
  ["image/webp", "webp"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);

/**
 * Strict key format accepted for uploaded images:
 *   uploads/YYYY-MM-DD/<lowercase-uuid>.(webp|jpg|png)
 */
export const STRICT_UPLOAD_KEY_REGEX =
  /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.(webp|jpg|png)$/;

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB
const DEFAULT_PRESIGN_EXPIRES_SECONDS = 90;

export function getMaxUploadBytes() {
  const raw = Number.parseInt(process.env.MAX_UPLOAD_BYTES ?? "", 10);
  if (Number.isFinite(raw) && raw >= 1024 && raw <= 20 * 1024 * 1024) {
    return raw;
  }
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export function getPresignExpiresSeconds() {
  const raw = Number.parseInt(
    process.env.R2_PRESIGN_EXPIRES_SECONDS ?? "",
    10
  );
  if (Number.isFinite(raw) && raw >= 30 && raw <= 300) {
    return raw;
  }
  return DEFAULT_PRESIGN_EXPIRES_SECONDS;
}

export function getR2PublicBaseUrl() {
  return getRequiredEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
}

export function isValidUploadKey(key) {
  return typeof key === "string" && STRICT_UPLOAD_KEY_REGEX.test(key);
}

export function buildPublicUrlForKey(key) {
  if (!isValidUploadKey(key)) {
    const err = new Error("Invalid R2 object key format");
    err.statusCode = 400;
    throw err;
  }
  return `${getR2PublicBaseUrl()}/${key}`;
}

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

/**
 * Generates an unpredictable server-controlled object key that strictly matches:
 *   ^uploads/\d{4}-\d{2}-\d{2}/[0-9a-f-]+\.(webp|jpg|png)$
 */
function buildObjectKey(contentType) {
  const ext = ALLOWED_IMAGE_MIME_TYPES.get(contentType);
  if (!ext) {
    const err = new Error("Unsupported image content type");
    err.statusCode = 400;
    throw err;
  }
  const datePrefix = new Date().toISOString().slice(0, 10);
  const uniqueId = crypto.randomUUID().toLowerCase();
  return `uploads/${datePrefix}/${uniqueId}.${ext}`;
}

/**
 * Generates a short-lived Cloudflare R2 Presigned PUT URL bound to exact
 * ContentType and ContentLength so attackers cannot upload oversized payloads.
 */
export async function createPresignedUploadUrl({ contentType, contentLength }) {
  const maxBytes = getMaxUploadBytes();
  const expiresIn = getPresignExpiresSeconds();

  if (
    !Number.isInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > maxBytes
  ) {
    const err = new Error(
      `Invalid contentLength. File size must be between 1 byte and ${maxBytes} bytes.`
    );
    err.statusCode = contentLength > maxBytes ? 413 : 400;
    throw err;
  }

  const bucket = getRequiredEnv("R2_BUCKET_NAME");
  const key = buildObjectKey(contentType);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const uploadUrl = await getSignedUrl(getR2Client(), command, {
    expiresIn,
  });

  const publicUrl = buildPublicUrlForKey(key);
  return {
    uploadUrl,
    key,
    publicUrl,
    expiresIn,
    maxBytes,
  };
}

/**
 * Verifies via R2 HeadObjectCommand that the uploaded object:
 * 1. Exists in the configured R2 bucket
 * 2. Has ContentLength within [1 .. MAX_UPLOAD_BYTES]
 * 3. Has an allowed image ContentType that matches the key's extension
 */
export async function verifyR2UploadedObject(key) {
  if (!isValidUploadKey(key)) {
    const err = new Error("Invalid object key format");
    err.statusCode = 400;
    throw err;
  }

  const bucket = getRequiredEnv("R2_BUCKET_NAME");
  const maxBytes = getMaxUploadBytes();

  let head;
  try {
    head = await getR2Client().send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (r2Err) {
    const httpStatus = r2Err?.$metadata?.httpStatusCode;
    const errName = r2Err?.name || "";
    if (
      httpStatus === 404 ||
      errName === "NotFound" ||
      errName === "NoSuchKey"
    ) {
      const err = new Error(
        "Uploaded object not found in R2 storage. Please upload the image before saving."
      );
      err.statusCode = 400;
      throw err;
    }
    throw r2Err;
  }

  const contentLength = Number(head?.ContentLength);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    const err = new Error("Uploaded object is empty or has invalid size.");
    err.statusCode = 400;
    throw err;
  }

  if (contentLength > maxBytes) {
    const err = new Error(
      `Uploaded object exceeds maximum allowed size (${maxBytes} bytes).`
    );
    err.statusCode = 413;
    throw err;
  }

  const normalizedType = String(head?.ContentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  const expectedExt = ALLOWED_IMAGE_MIME_TYPES.get(normalizedType);
  if (!expectedExt) {
    const err = new Error(
      `Unsupported uploaded object ContentType: ${normalizedType || "unknown"}`
    );
    err.statusCode = 400;
    throw err;
  }

  const keyExt = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (keyExt !== expectedExt) {
    const err = new Error(
      "Uploaded object ContentType does not match object key extension."
    );
    err.statusCode = 400;
    throw err;
  }

  return {
    contentLength,
    contentType: normalizedType,
  };
}

/**
 * Extracts an R2 object key from a public URL when a database record lacks `key`.
 */
export function extractR2KeyFromUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url.trim());
    return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

/**
 * Deletes an object from the configured Cloudflare R2 bucket via DeleteObjectCommand.
 */
export async function deleteR2Object(key) {
  const cleanKey =
    typeof key === "string" ? key.trim().replace(/^\/+/, "") : "";
  if (!cleanKey) {
    throw new Error("Empty R2 object key");
  }
  const bucket = getRequiredEnv("R2_BUCKET_NAME");
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: cleanKey,
  });
  await getR2Client().send(command);
}
