import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface CheckoutFormProps {
  username: string;
  quantity: number;
  amount: number;
  isDiscounted: boolean;
}

export function CheckoutForm({ username, quantity, amount, isDiscounted }: CheckoutFormProps) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    document: "",
  });
  const [loading, setLoading] = useState(false);
  const [pixData, setPixData] = useState<{ qr_code: string; qr_code_url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || !form.document) {
      toast.error("Preencha todos os campos");
      return;
    }

    setLoading(true);
    try {
      // Create order in DB
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          username,
          quantity,
          amount,
          is_discounted: isDiscounted,
          customer_name: form.name,
          customer_email: form.email,
          customer_phone: form.phone,
          customer_document: form.document,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Call edge function to create payment
      const { data: paymentData, error: fnError } = await supabase.functions.invoke(
        "create-payment",
        {
          body: {
            order_id: order.id,
            amount,
            customer: form,
          },
        }
      );

      if (fnError) throw fnError;

      if (paymentData?.pix) {
        setPixData(paymentData.pix);
      } else {
        toast.success("Pedido criado! Aguarde as instruções de pagamento.");
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao processar pedido. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const copyPixCode = () => {
    if (pixData?.qr_code) {
      navigator.clipboard.writeText(pixData.qr_code);
      setCopied(true);
      toast.success("Código Pix copiado!");
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (pixData) {
    return (
      <div className="gradient-card border border-border rounded-lg p-6 text-center space-y-4">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
        <h3 className="text-xl font-bold text-foreground">Pague via Pix</h3>
        <p className="text-muted-foreground text-sm">
          Escaneie o QR code ou copie o código
        </p>

        {pixData.qr_code_url && (
          <div className="flex justify-center">
            <img
              src={pixData.qr_code_url}
              alt="QR Code Pix"
              className="w-48 h-48 rounded-lg bg-foreground p-2"
            />
          </div>
        )}

        <Button
          onClick={copyPixCode}
          className="w-full gradient-instagram text-primary-foreground font-semibold"
        >
          {copied ? "Copiado ✓" : "Copiar código Pix"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Após o pagamento, os seguidores serão adicionados automaticamente.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="gradient-card border border-border rounded-lg p-5 space-y-4">
      <h3 className="font-bold text-foreground text-lg">Dados para pagamento</h3>

      <div className="space-y-2">
        <Label htmlFor="name" className="text-muted-foreground text-sm">Nome completo</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Seu nome completo"
          className="bg-background border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="text-muted-foreground text-sm">E-mail</Label>
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="seu@email.com"
          className="bg-background border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone" className="text-muted-foreground text-sm">Telefone</Label>
        <Input
          id="phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="21999999999"
          className="bg-background border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="document" className="text-muted-foreground text-sm">CPF</Label>
        <Input
          id="document"
          value={form.document}
          onChange={(e) => setForm({ ...form, document: e.target.value })}
          placeholder="000.000.000-00"
          className="bg-background border-border"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full gradient-instagram text-primary-foreground font-bold text-base py-5 animate-pulse-glow"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          `Pagar R$ ${(amount / 100).toFixed(2).replace(".", ",")} via Pix`
        )}
      </Button>
    </form>
  );
}
