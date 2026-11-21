import "./env.js";
import cors from "cors";
import express from "express";
import { getAllowedOrigins } from "./env.js";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  createPresignedUploadUrl,
} from "./clients/r2.js";
import { getSupabaseClient } from "./clients/supabase.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const allowedOrigins = getAllowedOrigins();

function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, "");

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
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      const err = new Error(`Origin not allowed by CORS: ${origin}`);
      err.statusCode = 403;
      callback(err);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));

// Root & Health check (supports both default AWS EB `/` and `/health` probes)
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "light-msg-server" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
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

// 2. POST /api/images -> Insert { url, key } into Supabase `images` table
app.post("/api/images", async (req, res, next) => {
  try {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";

    if (!url || !key) {
      return res.status(400).json({ error: "Both url and key are required" });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("images")
      .insert({ url, key })
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

// 3. GET /api/images -> Paginated query ordered by created_at DESC
app.get("/api/images", async (req, res, next) => {
  try {
    const rawPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const rawLimit = Number.parseInt(String(req.query.limit ?? "24"), 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 24;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("images")
      .select("*")
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
    });
  } catch (err) {
    return next(err);
  }
});

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
