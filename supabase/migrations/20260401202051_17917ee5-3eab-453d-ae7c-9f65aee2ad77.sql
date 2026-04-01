
ALTER TABLE public.quick_tags ADD COLUMN receipt_required boolean NOT NULL DEFAULT true;
ALTER TABLE public.transactions ADD COLUMN receipt_required boolean NOT NULL DEFAULT true;
