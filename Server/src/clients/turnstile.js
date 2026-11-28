const TURNSTILE_VERIFY_ENDPOINT =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function getTurnstileSecretKey() {
  return process.env.TURNSTILE_SECRET_KEY?.trim() || "";
}

export function isTurnstileEnabled() {
  return Boolean(getTurnstileSecretKey());
}

/**
 * Verifies a Cloudflare Turnstile response token against Cloudflare's Siteverify API.
 */
export async function verifyTurnstileToken({ token, remoteIp }) {
  const secret = getTurnstileSecretKey();
  if (!secret) {
    return { ok: true, skipped: true };
  }

  const trimmedToken = typeof token === "string" ? token.trim() : "";
  if (!trimmedToken || trimmedToken.length > 2048) {
    return {
      ok: false,
      errorCodes: ["missing-input-response"],
      message: "缺少人機驗證權杖（Cloudflare Turnstile），請重新送出。",
    };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", trimmedToken);
  if (remoteIp && remoteIp !== "unknown") {
    body.set("remoteip", remoteIp);
  }

  let res;
  try {
    res = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("[Turnstile] Siteverify network error:", err);
    return {
      ok: false,
      statusCode: 503,
      errorCodes: ["network-error"],
      message: "暫時無法連線至 Cloudflare 驗證服務，請稍後再試。",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      statusCode: 502,
      errorCodes: [`http-${res.status}`],
      message: "Cloudflare 驗證服務回應異常，請稍後再試。",
    };
  }

  const data = await res.json();
  if (!data?.success) {
    const codes = Array.isArray(data?.["error-codes"])
      ? data["error-codes"]
      : ["verification-failed"];
    console.warn("[Turnstile] Verification rejected:", {
      codes,
      hostname: data?.hostname,
    });
    return {
      ok: false,
      statusCode: 403,
      errorCodes: codes,
      message: codes.includes("timeout-or-duplicate")
        ? "驗證已過期或重複使用，請再試一次。"
        : "人機驗證未通過，請重新送出。",
    };
  }

  return {
    ok: true,
    hostname: data.hostname ?? null,
    action: data.action ?? null,
    challengeTs: data.challenge_ts ?? null,
  };
}
