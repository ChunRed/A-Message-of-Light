# Light-msg Server

Node.js + Express backend for **一則光的訊息 (A Message of Light)**, providing:
- Cloudflare R2 presigned PUT upload URLs (120s) and direct R2 deletion (`DeleteObjectCommand`)
- Supabase `images` persistence with `mailbox` (`1`–`6`) support & `?post=1..6` filtering
- Built-in HTML Admin Management Page (`GET /` and `GET /admin`) for managing & batch-deleting mailbox images

## Setup

1. Run `supabase-migration.sql` in Supabase SQL Editor to add the `mailbox` column (`1`–`6`) to `public.images`.
2. Configure `.env.local` (for local dev) or AWS Elastic Beanstalk Environment Properties (for production).
3. Install dependencies and run:

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health` — Health check (`{ status: "ok" }`)
- `GET /` & `GET /admin` — Built-in HTML Admin Page (supports both production domain and local `http://localhost:4000` / `http://localhost:4000/admin`; mailbox 1–6 switcher, select all, single/batch delete)
- `GET /api/admin/check` — Verifies `ADMIN_TOKEN` (when configured)
- `POST /api/upload-url` — Body `{ fileName, contentType }` (`image/webp`, `image/jpeg`, `image/png`), returns `{ uploadUrl, key, publicUrl }`
- `POST /api/images` — Body `{ url, key, mailbox }` (`mailbox`: integer `1`–`6`), inserts into Supabase `images`
- `GET /api/images?page=1&limit=24&post=6` — Paginated newest-first list; optional `post` (`1`–`6`) filters by `mailbox`
- `POST /api/images/delete` / `DELETE /api/images` — Body `{ ids: [...] }` or `{ id }`; deletes from R2 and Supabase (requires `ADMIN_TOKEN` if set)
