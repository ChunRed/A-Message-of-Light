import "./env.js";
import crypto from "node:crypto";
import http from "node:http";
import cors from "cors";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { getAllowedOrigins } from "./env.js";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  buildPublicUrlForKey,
  createPresignedUploadUrl,
  deleteR2Object,
  extractR2KeyFromUrl,
  getMaxUploadBytes,
  isValidUploadKey,
  verifyR2UploadedObject,
} from "./clients/r2.js";
import { getSupabaseClient } from "./clients/supabase.js";
import {
  isTurnstileEnabled,
  verifyTurnstileToken,
} from "./clients/turnstile.js";
import { createRateLimiter, getClientIp } from "./middleware/rateLimit.js";
import { renderAdminPageHtml } from "./views/adminPage.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const allowedOrigins = getAllowedOrigins();

// Respect reverse proxy headers (Cloudflare / AWS ALB) for accurate client IP rate limiting
const rawTrustProxy = process.env.TRUST_PROXY?.trim();
if (rawTrustProxy === "false" || rawTrustProxy === "0") {
  app.set("trust proxy", false);
} else if (rawTrustProxy && /^\d+$/.test(rawTrustProxy)) {
  app.set("trust proxy", Number.parseInt(rawTrustProxy, 10));
} else {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

// Basic hardening headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

const MAILBOX_COUNT = 5;
const LED_CHANNEL_COUNT = 30;

/**
 * Strictly parses a mailbox / post number in the inclusive range 1..5.
 * Rejects empty strings, 0, 6+, decimals, negative numbers, and out-of-range values.
 */
function parseMailboxNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!/^[1-5]$/.test(str)) return null;
  return Number.parseInt(str, 10);
}

/**
 * Validates and clamps a 30-channel LED sample array into integers [0..255].
 */
function parseLedValues30(raw) {
  if (!Array.isArray(raw) || raw.length !== LED_CHANNEL_COUNT) {
    return null;
  }
  const normalized = new Array(LED_CHANNEL_COUNT);
  for (let i = 0; i < LED_CHANNEL_COUNT; i++) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) return null;
    normalized[i] = Math.max(0, Math.min(255, Math.round(n)));
  }
  return normalized;
}

/**
 * Strictly parses positive integer byte length for upload validation.
 */
function parseContentLength(raw) {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function getConfiguredAdminToken() {
  return process.env.ADMIN_TOKEN?.trim() || "";
}

function safeTokenEqual(provided, expected) {
  const hashA = crypto.createHash("sha256").update(provided).digest();
  const hashB = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function extractRequestAdminToken(req) {
  const headerToken = req.get("X-Admin-Token")?.trim();
  if (headerToken) return headerToken;

  const authHeader = req.get("Authorization")?.trim() || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return "";
}

function requireAdminAuth(req, res, next) {
  const expected = getConfiguredAdminToken();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({
        error: "Admin authentication is not configured on this server.",
      });
    }
    return next();
  }
  const provided = extractRequestAdminToken(req);
  if (provided && safeTokenEqual(provided, expected)) {
    return next();
  }
  return res.status(401).json({
    error: "Unauthorized: valid ADMIN_TOKEN is required",
  });
}

function isOriginAllowed(origin, req) {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, "");

  // Always allow same-origin requests to this Express server (e.g. built-in Admin Page
  // accessed via http://localhost:4000, http://127.0.0.1:4000, or production domain)
  const requestHost = req?.get("host")?.trim();
  if (
    requestHost &&
    (normalized === `http://${requestHost}` ||
      normalized === `https://${requestHost}`)
  ) {
    return true;
  }

  // Always allow local Express admin origins (localhost / 127.0.0.1 on configured port & 4000)
  const localSelfOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:4000",
    "http://127.0.0.1:4000",
  ]);
  if (localSelfOrigins.has(normalized)) {
    return true;
  }

  return allowedOrigins.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern === normalized) return true;
    // Support wildcard subdomains such as https://*.vercel.app
    if (pattern.includes("*")) {
      const escaped = pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^.]+");
      return new RegExp(`^${escaped}$`, "i").test(normalized);
    }
    return false;
  });
}

app.use(
  cors((req, callback) => {
    const origin = req.get("Origin");
    if (isOriginAllowed(origin, req)) {
      callback(null, {
        origin: true,
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Admin-Token",
          "CF-Turnstile-Response",
        ],
      });
      return;
    }
    const err = new Error(`Origin not allowed by CORS: ${origin}`);
    err.statusCode = 403;
    callback(err);
  })
);

app.use(express.json({ limit: "256kb" }));

// =========================================================================
// APPLICATION-LAYER MULTI-WINDOW RATE LIMITERS (complement Cloudflare WAF)
// =========================================================================
const uploadUrlMinuteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 6,
  keyPrefix: "upload-url-1m",
  message: "上傳請求過於頻繁，請稍候 1 分鐘再試。",
});

const uploadUrlHourlyLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyPrefix: "upload-url-1h",
  message: "已達每小時上傳次數上限，請稍後再試。",
});

const saveImageMinuteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyPrefix: "save-image-1m",
  message: "寫入圖片紀錄過於頻繁，請稍後再試。",
});

const readImagesMinuteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: "read-images-1m",
  message: "讀取請求過於頻繁，請稍後再試。",
});

const adminRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyPrefix: "admin-5m",
  message: "管理請求過於頻繁，請稍後再試。",
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mailboxes: MAILBOX_COUNT,
    turnstileEnabled: isTurnstileEnabled(),
  });
});

// Admin Management Page (supports https://light-msg-server.nosidehere.space & /admin,
// and also returns HTTP 200 OK for default AWS Elastic Beanstalk `/` health probes)
function handleRenderAdminPage(_req, res) {
  const html = renderAdminPageHtml({
    requiresAdminToken: Boolean(getConfiguredAdminToken()),
    mailboxCount: MAILBOX_COUNT,
  });
  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
}

app.get("/", handleRenderAdminPage);
app.get("/admin", handleRenderAdminPage);

// Optional admin token check endpoint for Admin Page UI
app.get("/api/admin/check", adminRateLimiter, requireAdminAuth, (_req, res) => {
  res.json({ ok: true, tokenRequired: Boolean(getConfiguredAdminToken()) });
});

// 1. POST /api/upload-url -> Verify Turnstile + ContentLength + MIME, generate R2 Presigned PUT URL
app.post(
  "/api/upload-url",
  uploadUrlMinuteLimiter,
  uploadUrlHourlyLimiter,
  async (req, res, next) => {
    try {
      const contentType =
        typeof req.body?.contentType === "string"
          ? req.body.contentType.trim().toLowerCase()
          : "";
      const contentLength = parseContentLength(req.body?.contentLength);
      const maxBytes = getMaxUploadBytes();

      if (!ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
        return res.status(400).json({
          error:
            "Unsupported contentType. Only image/webp, image/jpeg, and image/png are allowed.",
        });
      }

      if (contentLength === null) {
        return res.status(400).json({
          error: "contentLength is required and must be a positive integer.",
        });
      }

      if (contentLength > maxBytes) {
        return res.status(413).json({
          error: `File size exceeds maximum allowed limit (${maxBytes} bytes).`,
          maxBytes,
        });
      }

      if (isTurnstileEnabled()) {
        const turnstileToken =
          typeof req.body?.turnstileToken === "string"
            ? req.body.turnstileToken
            : req.get("CF-Turnstile-Response") || "";

        const verification = await verifyTurnstileToken({
          token: turnstileToken,
          remoteIp: getClientIp(req),
        });

        if (!verification.ok) {
          return res.status(verification.statusCode || 403).json({
            error: verification.message || "Turnstile verification failed.",
            errorCodes: verification.errorCodes,
          });
        }
      }

      const result = await createPresignedUploadUrl({
        contentType,
        contentLength,
      });
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  }
);

// 2. POST /api/images -> Accept ONLY { key, mailbox (1..5) }, verify key regex + R2 HeadObject,
//    assemble public URL server-side from R2_PUBLIC_BASE_URL + "/" + key, and insert into Supabase.
app.post("/api/images", saveImageMinuteLimiter, async (req, res, next) => {
  try {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    const mailbox = parseMailboxNumber(req.body?.mailbox);

    if (!key) {
      return res.status(400).json({ error: "key is required" });
    }

    if (!isValidUploadKey(key)) {
      return res.status(400).json({
        error:
          "Invalid key format. Must match uploads/YYYY-MM-DD/<hex-uuid>.(webp|jpg|png).",
      });
    }

    if (mailbox === null) {
      return res.status(400).json({
        error: "mailbox is required and must be an integer between 1 and 5",
      });
    }

    // Confirm the object actually exists in R2, is within size limit, and has an allowed image ContentType
    await verifyR2UploadedObject(key);

    // Never trust client-provided URLs; always construct from server-configured R2_PUBLIC_BASE_URL
    const url = buildPublicUrlForKey(key);

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("images")
      .insert({ url, key, mailbox })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "This image key has already been recorded.",
        });
      }
      console.error("[Supabase Insert Error]", error);
      return res.status(500).json({
        error: "Failed to save image record",
      });
    }

    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
});

// 3. GET /api/images -> Paginated query (newest first)
//    - Omit `post` or pass `post=all` to view ALL images across all mailboxes
//    - Pass `post=1..5` to filter strictly by that mailbox
app.get("/api/images", readImagesMinuteLimiter, async (req, res, next) => {
  try {
    const rawPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const rawLimit = Number.parseInt(String(req.query.limit ?? "24"), 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 24;

    const rawPost =
      req.query.post !== undefined ? String(req.query.post).trim() : "";
    const wantsAll = rawPost === "" || rawPost.toLowerCase() === "all";

    let postMailbox = null;
    if (!wantsAll) {
      postMailbox = parseMailboxNumber(rawPost);
      if (postMailbox === null) {
        return res.status(400).json({
          error:
            "Invalid post parameter. Must be 'all' or an integer between 1 and 5.",
        });
      }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const supabase = getSupabaseClient();
    let query = supabase.from("images").select("*");
    if (postMailbox !== null) {
      query = query.eq("mailbox", postMailbox);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("[Supabase Fetch Error]", error);
      return res.status(500).json({
        error: "Failed to fetch images",
      });
    }

    return res.json({
      items: data ?? [],
      page,
      limit,
      ...(postMailbox !== null ? { post: postMailbox } : {}),
    });
  } catch (err) {
    return next(err);
  }
});

// 4. POST /api/images/delete & DELETE /api/images -> Delete from Cloudflare R2 + Supabase
async function handleDeleteImages(req, res, next) {
  try {
    let rawIds = [];
    if (Array.isArray(req.body?.ids)) {
      rawIds = req.body.ids;
    } else if (req.body?.id !== undefined && req.body?.id !== null) {
      rawIds = [req.body.id];
    }

    const ids = rawIds
      .map((v) => (typeof v === "string" ? v.trim() : v))
      .filter((v) => v !== "" && v !== null && v !== undefined);

    if (ids.length === 0) {
      return res.status(400).json({
        error: "Please provide a non-empty `ids` array or `id` to delete.",
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: "At most 100 images can be deleted in a single request.",
      });
    }

    const supabase = getSupabaseClient();

    // Step 1: Fetch target rows from Supabase to retrieve R2 keys (or URLs for key fallback)
    const { data: rows, error: fetchError } = await supabase
      .from("images")
      .select("id, key, url, mailbox")
      .in("id", ids);

    if (fetchError) {
      console.error("[Supabase Pre-delete Query Error]", fetchError);
      return res.status(500).json({
        error: "Failed to query image records before deletion",
      });
    }

    const foundRows = rows ?? [];
    const foundIdSet = new Set(foundRows.map((r) => String(r.id)));
    const notFoundIds = ids.filter((id) => !foundIdSet.has(String(id)));

    const details = [];
    const idsReadyForDbDelete = [];
    const failed = [];

    // Step 2: Delete corresponding objects from Cloudflare R2 bucket via DeleteObjectCommand
    for (const row of foundRows) {
      const objectKey =
        (row.key && String(row.key).trim()) || extractR2KeyFromUrl(row.url);

      if (!objectKey) {
        failed.push({
          id: row.id,
          reason: "Unable to resolve R2 object key from record",
        });
        continue;
      }

      try {
        await deleteR2Object(objectKey);
        idsReadyForDbDelete.push(row.id);
        details.push({
          id: row.id,
          key: objectKey,
          mailbox: row.mailbox ?? null,
          r2Deleted: true,
          dbDeleted: false,
        });
      } catch (r2Err) {
        failed.push({
          id: row.id,
          key: objectKey,
          reason: `R2 deletion failed: ${r2Err?.message || "Unknown error"}`,
        });
      }
    }

    // Step 3: Delete successfully R2-removed rows from Supabase `images` table
    let deletedIds = [];
    if (idsReadyForDbDelete.length > 0) {
      const { error: dbDeleteError } = await supabase
        .from("images")
        .delete()
        .in("id", idsReadyForDbDelete);

      if (dbDeleteError) {
        console.error("[Supabase Delete Error]", dbDeleteError);
        return res.status(500).json({
          error:
            "R2 objects deleted, but failed to remove records from Supabase",
          r2DeletedIds: idsReadyForDbDelete,
        });
      }

      deletedIds = idsReadyForDbDelete;
      for (const item of details) {
        item.dbDeleted = true;
      }
    }

    return res.json({
      requestedCount: ids.length,
      deletedCount: deletedIds.length,
      deletedIds,
      notFoundIds,
      failed,
      details,
    });
  } catch (err) {
    return next(err);
  }
}

app.post(
  "/api/images/delete",
  adminRateLimiter,
  requireAdminAuth,
  handleDeleteImages
);
app.delete(
  "/api/images",
  adminRateLimiter,
  requireAdminAuth,
  handleDeleteImages
);

// Centralized error handler
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }
  const status = err?.statusCode || 500;
  console.error("[Server Error]", err);
  const message =
    status >= 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err?.message || "Internal server error";
  return res.status(status).json({
    error: message,
  });
});

// =========================================================================
// SOCKET.IO v4 REALTIME RELAY (Web `client-msg` -> ESP32 `esp-msg`)
// =========================================================================
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin(origin, callback) {
      if (isOriginAllowed(origin, null)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Socket.IO origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Per-socket anti-spam window for `client-msg` (max 10 messages / 60s per socket)
const SOCKET_MSG_WINDOW_MS = 60 * 1000;
const SOCKET_MSG_MAX_PER_WINDOW = 10;

io.on("connection", (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  let windowStartMs = Date.now();
  let windowCount = 0;

  socket.on("client-msg", (rawPayload, ack) => {
    const now = Date.now();
    if (now - windowStartMs >= SOCKET_MSG_WINDOW_MS) {
      windowStartMs = now;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > SOCKET_MSG_MAX_PER_WINDOW) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Too many client-msg events" });
      }
      return;
    }

    const mailbox = parseMailboxNumber(rawPayload?.mailbox);
    const ledValues = parseLedValues30(
      rawPayload?.ledValues ?? rawPayload?.values
    );

    if (mailbox === null || ledValues === null) {
      if (typeof ack === "function") {
        ack({
          ok: false,
          error: "Invalid payload: requires mailbox (1..5) and 30 ledValues (0..255)",
        });
      }
      return;
    }

    const relayPayload = {
      mailbox,
      ledValues,
    };

    io.emit("esp-msg", relayPayload);
    console.log(
      `[Socket.IO] Relayed client-msg -> esp-msg (mailbox=${mailbox}, from=${socket.id})`
    );

    if (typeof ack === "function") {
      ack({ ok: true, mailbox });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(port, () => {
  console.log(
    `[Light-msg Server] HTTP + Socket.IO listening on http://localhost:${port} (mailboxes: 1..${MAILBOX_COUNT}, turnstile: ${
      isTurnstileEnabled() ? "enabled" : "disabled"
    }, maxUploadBytes: ${getMaxUploadBytes()})`
  );
});
