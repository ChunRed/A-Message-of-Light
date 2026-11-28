import net from "node:net";

/**
 * Extracts best-effort client IP while respecting Cloudflare's CF-Connecting-IP
 * and Express's configured `trust proxy`.
 */
export function getClientIp(req) {
  if (process.env.USE_CF_CONNECTING_IP !== "false") {
    const cfIp = req.get("CF-Connecting-IP")?.trim();
    if (cfIp && net.isIP(cfIp)) {
      return cfIp;
    }
  }
  const expressIp = typeof req.ip === "string" ? req.ip.trim() : "";
  if (expressIp) return expressIp;
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Lightweight, zero-dependency fixed-window IP rate limiter for Express.
 * Designed as the application-layer second line of defense behind Cloudflare WAF.
 */
export function createRateLimiter({
  windowMs,
  max,
  message = "請求過於頻繁，請稍後再試。",
  keyPrefix = "rl",
  maxTrackedKeys = 20000,
}) {
  const buckets = new Map();

  // Periodically sweep expired buckets so memory remains bounded
  const sweepIntervalMs = Math.max(30_000, Math.min(windowMs, 5 * 60_000));
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, sweepIntervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;

    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      // Guard against unbounded map growth under distributed floods
      if (buckets.size >= maxTrackedKeys) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) {
          buckets.delete(oldestKey);
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(retryAfterSec));

    if (entry.count > max) {
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: message,
        retryAfterSeconds: retryAfterSec,
      });
    }

    return next();
  };
}
