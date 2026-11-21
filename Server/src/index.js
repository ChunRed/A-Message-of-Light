import "./env.js";
import cors from "cors";
import express from "express";
import { getAllowedOrigins } from "./env.js";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  createPresignedUploadUrl,
  deleteR2Object,
  extractR2KeyFromUrl,
} from "./clients/r2.js";
import { getSupabaseClient } from "./clients/supabase.js";
import { renderAdminPageHtml } from "./views/adminPage.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const allowedOrigins = getAllowedOrigins();

/**
 * Strictly parses a mailbox / post number in the inclusive range 1..6.
 * Rejects empty strings, 0, decimals, negative numbers, and out-of-range values.
 */
function parseMailboxNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!/^[1-6]$/.test(str)) return null;
  return Number.parseInt(str, 10);
}

function getConfiguredAdminToken() {
  return process.env.ADMIN_TOKEN?.trim() || "";
}

function extractRequestAdminToken(req) {
  const headerToken = req.get("X-Admin-Token")?.trim();
  if (headerToken) return headerToken;

  const authHeader = req.get("Authorization")?.trim() || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  if (typeof req.query?.token === "string" && req.query.token.trim()) {
    return req.query.token.trim();
  }
  if (typeof req.body?.token === "string" && req.body.token.trim()) {
    return req.body.token.trim();
  }
  return "";
}

function requireAdminAuth(req, res, next) {
  const expected = getConfiguredAdminToken();
  if (!expected) {
    return next();
  }
  const provided = extractRequestAdminToken(req);
  if (provided && provided === expected) {
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
        allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
      });
      return;
    }
    const err = new Error(`Origin not allowed by CORS: ${origin}`);
    err.statusCode = 403;
    callback(err);
  })
);

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Admin Management Page (supports https://light-msg-server.nosidehere.space & /admin,
// and also returns HTTP 200 OK for default AWS Elastic Beanstalk `/` health probes)
function handleRenderAdminPage(_req, res) {
  const html = renderAdminPageHtml({
    requiresAdminToken: Boolean(getConfiguredAdminToken()),
  });
  res.status(200).set("Content-Type", "text/html; charset=utf-8").send(html);
}

app.get("/", handleRenderAdminPage);
app.get("/admin", handleRenderAdminPage);

// Optional admin token check endpoint for Admin Page UI
app.get("/api/admin/check", requireAdminAuth, (_req, res) => {
  res.json({ ok: true, tokenRequired: Boolean(getConfiguredAdminToken()) });
});

// 1. POST /api/upload-url -> Generate Cloudflare R2 Presigned PUT URL (120s)
app.post("/api/upload-url", async (req, res, next) => {
  try {
    const fileName =
      typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
    const contentType =
      typeof req.body?.contentType === "string"
        ? req.body.contentType.trim().toLowerCase()
        : "";

    if (!fileName) {
      return res.status(400).json({ error: "fileName is required" });
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
      return res.status(400).json({
        error:
          "Unsupported contentType. Only image/webp, image/jpeg, and image/png are allowed.",
      });
    }

    const result = await createPresignedUploadUrl({ fileName, contentType });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// 2. POST /api/images -> Validate { url, key, mailbox (1..6) } & insert into Supabase `images`
app.post("/api/images", async (req, res, next) => {
  try {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    const mailbox = parseMailboxNumber(req.body?.mailbox);

    if (!url || !key) {
      return res.status(400).json({ error: "Both url and key are required" });
    }

    if (mailbox === null) {
      return res.status(400).json({
        error: "mailbox is required and must be an integer between 1 and 6",
      });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("images")
      .insert({ url, key, mailbox })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "Failed to save image record",
        details: error.message,
      });
    }

    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
});

// 3. GET /api/images -> Paginated query (newest first) with optional strict `post` (1..6) filter
app.get("/api/images", async (req, res, next) => {
  try {
    const rawPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const rawLimit = Number.parseInt(String(req.query.limit ?? "24"), 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 24;

    // Explicitly check `post` parameter so "0" or invalid strings are rejected rather than misclassified
    const hasPostParam =
      req.query.post !== undefined && String(req.query.post).trim() !== "";
    let postMailbox = null;
    if (hasPostParam) {
      postMailbox = parseMailboxNumber(req.query.post);
      if (postMailbox === null) {
        return res.status(400).json({
          error: "Invalid post parameter. Must be an integer between 1 and 6.",
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
      return res.status(500).json({
        error: "Failed to fetch images",
        details: error.message,
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

    const supabase = getSupabaseClient();

    // Step 1: Fetch target rows from Supabase to retrieve R2 keys (or URLs for key fallback)
    const { data: rows, error: fetchError } = await supabase
      .from("images")
      .select("id, key, url, mailbox")
      .in("id", ids);

    if (fetchError) {
      return res.status(500).json({
        error: "Failed to query image records before deletion",
        details: fetchError.message,
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
      const objectKey = (row.key && String(row.key).trim()) || extractR2KeyFromUrl(row.url);

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
        return res.status(500).json({
          error: "R2 objects deleted, but failed to remove records from Supabase",
          details: dbDeleteError.message,
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

app.post("/api/images/delete", requireAdminAuth, handleDeleteImages);
app.delete("/api/images", requireAdminAuth, handleDeleteImages);

// Centralized error handler
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }
  const status = err?.statusCode || 500;
  console.error("[Server Error]", err);
  return res.status(status).json({
    error: err?.message || "Internal server error",
  });
});

app.listen(port, () => {
  console.log(`[Light-msg Server] Listening on http://localhost:${port}`);
});
