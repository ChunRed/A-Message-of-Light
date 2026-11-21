export const MAILBOX_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type MailboxNumber = (typeof MAILBOX_NUMBERS)[number];

export interface PresignedUploadResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface LibraryImageItem {
  id: string | number;
  url: string;
  key: string;
  mailbox?: number | null;
  created_at?: string;
}

export interface LibraryImagesPageResponse {
  items: LibraryImageItem[];
  page: number;
  limit: number;
  post?: number;
}

export type UploadProgressPhase =
  | "requesting-url"
  | "uploading-r2"
  | "saving-record";

/**
 * Strictly parses a `post` / `mailbox` value into 1..6 (rejects 0, "", or out-of-range values).
 */
export function parseMailboxParam(
  raw: string | number | null | undefined
): MailboxNumber | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!/^[1-6]$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10) as MailboxNumber;
}

export function getMailboxShareUrl(mailbox: MailboxNumber): string {
  if (typeof window === "undefined") return `?post=${mailbox}`;
  return `${window.location.origin}?post=${mailbox}`;
}

export function getApiBaseUrl(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "尚未設定 NEXT_PUBLIC_API_BASE_URL，請檢查環境變數設定。"
    );
  }
  return base;
}

/**
 * Converts a Canvas element or Data URL into an `image/webp` Blob (quality = 0.85).
 */
export async function convertSourceToWebpBlob(
  source: HTMLCanvasElement | string,
  quality = 0.85
): Promise<Blob> {
  let canvas: HTMLCanvasElement;

  if (typeof source === "string") {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("無法讀取生成圖片資料"));
      el.src = source;
    });
    canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("瀏覽器 2D Canvas 環境不可用");
    ctx.drawImage(img, 0, 0);
  } else {
    canvas = source;
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("圖片轉換為 WebP 失敗"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality
    );
  });
}

/**
 * Full direct-to-R2 upload & Supabase persistence flow (binary NEVER passes through Node server):
 * 1. POST ${API_BASE_URL}/api/upload-url -> { uploadUrl, publicUrl, key }
 * 2. PUT uploadUrl (Content-Type: image/webp, body: blob) directly to Cloudflare R2
 * 3. POST ${API_BASE_URL}/api/images -> { url: publicUrl, key, mailbox }
 */
export async function uploadWebpBlobToLibrary(
  blob: Blob,
  mailbox: MailboxNumber,
  fileName = "light-message.webp",
  onPhaseChange?: (phase: UploadProgressPhase) => void
): Promise<LibraryImageItem> {
  const apiBase = getApiBaseUrl();

  // Step 1: Request presigned PUT URL from Express server (JSON metadata only)
  onPhaseChange?.("requesting-url");
  const presignRes = await fetch(`${apiBase}/api/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName,
      contentType: "image/webp",
    }),
  });

  if (!presignRes.ok) {
    let msg = `取得上傳連結失敗 (${presignRes.status})`;
    try {
      const errJson = (await presignRes.json()) as { error?: string };
      if (errJson?.error) msg = errJson.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  const { uploadUrl, publicUrl, key } =
    (await presignRes.json()) as PresignedUploadResponse;

  if (!uploadUrl || !publicUrl || !key) {
    throw new Error("伺服器回傳的上傳憑證不完整");
  }

  // Step 2: Upload binary WebP Blob DIRECTLY to Cloudflare R2
  onPhaseChange?.("uploading-r2");
  const r2Res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "image/webp",
    },
    body: blob,
  });

  if (!r2Res.ok) {
    throw new Error(`雲端圖片上傳失敗 (${r2Res.status})`);
  }

  // Step 3: Record { url, key, mailbox } in Supabase via Express API
  onPhaseChange?.("saving-record");
  const saveRes = await fetch(`${apiBase}/api/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: publicUrl,
      key,
      mailbox,
    }),
  });

  if (!saveRes.ok) {
    let msg = `儲存圖片紀錄失敗 (${saveRes.status})`;
    try {
      const errJson = (await saveRes.json()) as { error?: string };
      if (errJson?.error) msg = errJson.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return (await saveRes.json()) as LibraryImageItem;
}

/**
 * Fetches paginated images ordered newest-first from GET ${API_BASE_URL}/api/images.
 * When `post` (1..6) is provided, appends `&post=<N>` to filter strictly by that mailbox.
 */
export async function fetchLibraryImages(
  page = 1,
  limit = 24,
  post?: MailboxNumber | null,
  signal?: AbortSignal
): Promise<LibraryImagesPageResponse> {
  const apiBase = getApiBaseUrl();
  const params = new URLSearchParams();
  if (post !== null && post !== undefined) {
    params.set("post", String(post));
  }
  params.set("page", String(page));
  params.set("limit", String(limit));

  const res = await fetch(`${apiBase}/api/images?${params.toString()}`, {
    method: "GET",
    signal,
  });

  if (!res.ok) {
    let msg = `載入圖庫失敗 (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson?.error) msg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as LibraryImagesPageResponse;
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    page: data?.page ?? page,
    limit: data?.limit ?? limit,
    post: data?.post,
  };
}
