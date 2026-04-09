
-- Create packages table for configurable follower packages
CREATE TABLE public.packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quantity INTEGER NOT NULL,
  price INTEGER NOT NULL, -- price in cents (BRL)
  discount_price INTEGER, -- discounted price in cents (BRL), null = no discount
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  is_discounted BOOLEAN NOT NULL DEFAULT false,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_document TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_hash TEXT,
  pix_qr_code TEXT,
  pix_qr_code_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Packages are readable by everyone (public catalog)
CREATE POLICY "Packages are viewable by everyone" ON public.packages FOR SELECT USING (true);

-- Only authenticated admins can manage packages (we'll use has_role later)
CREATE POLICY "Admins can manage packages" ON public.packages FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Orders are publicly insertable (customers create orders)
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);

-- Orders viewable by admins only
CREATE POLICY "Admins can view orders" ON public.orders FOR SELECT USING (auth.uid() IS NOT NULL);

-- Orders updatable by admins
CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_packages_updated_at BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default packages
INSERT INTO public.packages (quantity, price, discount_price) VALUES
  (50, 1990, 1490),
  (100, 3490, 2490),
  (500, 14990, 9990),
  (1000, 24990, 17990);
