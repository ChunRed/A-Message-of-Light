# Light-msg Server

Node.js + Express backend for **一則光的訊息 (A Message of Light)**, providing Cloudflare R2 presigned image upload URLs and Supabase `images` persistence/pagination.

## Setup

1. Fill in `R2_BUCKET_NAME` and `R2_PUBLIC_BASE_URL` in `.env.local`.
2. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health` — Health check (`{ status: "ok" }`)
- `POST /api/upload-url` — Body `{ fileName, contentType }` (`image/webp`, `image/jpeg`, `image/png`), returns `{ uploadUrl, key, publicUrl }` (120s presigned PUT URL)
- `POST /api/images` — Body `{ url, key }`, inserts into Supabase `images` table and returns the inserted row
- `GET /api/images?page=1&limit=24` — Returns `{ items, page, limit }` ordered by `created_at` descending
