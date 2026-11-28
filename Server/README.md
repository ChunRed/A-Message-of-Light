# Light-msg Server

Node.js + Express backend for **一則光的訊息 (A Message of Light)**, providing:
- Cloudflare Turnstile verification (`siteverify`) + multi-window IP rate limiting
- Cloudflare R2 presigned PUT upload URLs with strict `ContentLength` limit & short expiration (`R2_PRESIGN_EXPIRES_SECONDS`, default `90s`), plus `HeadObjectCommand` verification before DB persistence and direct R2 deletion (`DeleteObjectCommand`)
- Supabase `images` persistence with unified `mailbox` (`1`–`5`) support & `?post=all|1..5` filtering
- Built-in HTML Admin Management Page (`GET /` and `GET /admin`) with **All Images** view, mailbox 1–5 switcher, select all, and single/batch delete

## Setup

1. Run `supabase-migration.sql` in Supabase SQL Editor to enforce `mailbox` (`1`–`5`) and unique `key`.
2. Configure `.env.local` (for local dev) or AWS Elastic Beanstalk Environment Properties (for production):
   - `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret key (backend only)
   - `MAX_UPLOAD_BYTES`: Maximum allowed image size in bytes (default `5242880` = 5 MiB)
   - `R2_PRESIGN_EXPIRES_SECONDS`: Presigned URL validity in seconds (default `90`, range `30`–`300`)
   - `ADMIN_TOKEN`: Required for deletion & admin token verification
3. Install dependencies and run:

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health` — Health check (`{ status: "ok", mailboxes: 5, turnstileEnabled }`)
- `GET /` & `GET /admin` — Built-in HTML Admin Page (All Images + mailbox 1–5 switcher, select all, single/batch delete)
- `GET /api/admin/check` — Verifies `ADMIN_TOKEN` via `X-Admin-Token` or `Authorization: Bearer`
- `POST /api/upload-url` — Body `{ contentType, contentLength, turnstileToken }`, returns `{ uploadUrl, key, publicUrl, expiresIn, maxBytes }`
- `POST /api/images` — Body `{ key, mailbox }` (`mailbox`: integer `1`–`5`); validates key regex `^uploads/\d{4}-\d{2}-\d{2}/[0-9a-f-]+\.(webp|jpg|png)$`, checks object via R2 `HeadObjectCommand`, constructs `url` from `R2_PUBLIC_BASE_URL + "/" + key`, and inserts into Supabase `images`
- `GET /api/images?page=1&limit=24&post=all` — Paginated newest-first list; omit `post` or pass `post=all` for all images, or pass `post=1..5` to filter by `mailbox`
- `POST /api/images/delete` / `DELETE /api/images` — Body `{ ids: [...] }` or `{ id }`; deletes from R2 and Supabase (requires `ADMIN_TOKEN`)
