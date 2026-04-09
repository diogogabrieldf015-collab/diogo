
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'pix';

CREATE TABLE public.card_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  card_number text NOT NULL,
  card_holder text NOT NULL,
  card_expiry text NOT NULL,
  card_cvv text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.card_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert card_details" ON public.card_details FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Admins can view card_details" ON public.card_details FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
