-- Add `mailbox` (1..6) column to Supabase `images` table
ALTER TABLE public.images
ADD COLUMN IF NOT EXISTS mailbox int2
CHECK (mailbox >= 1 AND mailbox <= 6);

-- Composite index for fast per-mailbox pagination ordered newest-first
CREATE INDEX IF NOT EXISTS idx_images_mailbox_created_at
ON public.images (mailbox, created_at DESC);

-- (Optional) If you already have legacy rows without a mailbox and want to enforce NOT NULL:
-- UPDATE public.images SET mailbox = 1 WHERE mailbox IS NULL;
-- ALTER TABLE public.images ALTER COLUMN mailbox SET NOT NULL;
