-- Add `mailbox` (1..5) column to Supabase `images` table
ALTER TABLE public.images
ADD COLUMN IF NOT EXISTS mailbox int2;

-- Replace constraint to strictly allow mailboxes 1..5
ALTER TABLE public.images
DROP CONSTRAINT IF EXISTS images_mailbox_check;

ALTER TABLE public.images
ADD CONSTRAINT images_mailbox_check
CHECK (mailbox >= 1 AND mailbox <= 5);

-- Enforce unique R2 object key to prevent replay/duplicate inserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_key_unique
ON public.images (key);

-- Composite index for fast per-mailbox pagination ordered newest-first
CREATE INDEX IF NOT EXISTS idx_images_mailbox_created_at
ON public.images (mailbox, created_at DESC);

-- (Optional) If you already have legacy rows with mailbox = 6 or NULL:
-- UPDATE public.images SET mailbox = 5 WHERE mailbox > 5;
-- UPDATE public.images SET mailbox = 1 WHERE mailbox IS NULL;
-- ALTER TABLE public.images ALTER COLUMN mailbox SET NOT NULL;
