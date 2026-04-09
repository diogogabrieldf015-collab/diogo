-- Gateway ativo (default) + rastreio por pedido (troca no admin não quebra PIX antigo)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'x';

INSERT INTO public.settings (key, value) VALUES ('payment_gateway', 'x')
ON CONFLICT (key) DO NOTHING;
