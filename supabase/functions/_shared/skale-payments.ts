/** https://docs.skalepayments.com.br — PIX via POST /transactions */

export function getSkaleApiKey(): string | null {
  return Deno.env.get("SKALE_API_KEY")?.trim() || null;
}

export function getSkaleApiBase(): string {
  return (Deno.env.get("SKALE_API_BASE") ?? "https://api.skalepayments.com.br").replace(/\/+$/, "");
}

/** Limites do gateway (centavos), conforme documentação */
export const SKALE_MIN_CENTS = 500;
export const SKALE_MAX_CENTS = 60000;

export function documentTypeForSkale(digits: string): "cpf" | "cnpj" {
  return digits.length > 11 ? "cnpj" : "cpf";
}

export async function skaleCreatePix(params: {
  amountCents: number;
  postbackUrl: string;
  customer: { name: string; email: string; phone: string; documentDigits: string };
  items: { title: string; unitPrice: number; quantity: number; tangible: boolean; externalRef?: string }[];
  metadata: Record<string, string>;
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; body: unknown }> {
  const key = getSkaleApiKey();
  if (!key) {
    return {
      ok: false,
      status: 500,
      body: {
        error:
          "SKALE_API_KEY não está definida. No Supabase: Project Settings → Edge Functions → Secrets → adicione SKALE_API_KEY com a chave da SkalePayments.",
      },
    };
  }

  const body = {
    amount: params.amountCents,
    paymentMethod: "pix",
    pix: { expiresInDays: 1 },
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      phone: params.customer.phone.replace(/\D/g, "") || "11999999999",
      document: {
        number: params.customer.documentDigits,
        type: documentTypeForSkale(params.customer.documentDigits),
      },
    },
    items: params.items,
    metadata: params.metadata,
    postbackUrl: params.postbackUrl,
  };

  const res = await fetch(`${getSkaleApiBase()}/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data: data as Record<string, unknown> };
}

export async function skaleGetTransaction(
  transactionId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; body: unknown }> {
  const key = getSkaleApiKey();
  if (!key) {
    return {
      ok: false,
      status: 500,
      body: {
        error:
          "SKALE_API_KEY não está definida. No Supabase: Project Settings → Edge Functions → Secrets → adicione SKALE_API_KEY com a chave da SkalePayments.",
      },
    };
  }

  const res = await fetch(`${getSkaleApiBase()}/transactions/${encodeURIComponent(transactionId)}`, {
    method: "GET",
    headers: { "X-API-Key": key, Accept: "application/json" },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, body: data };
  return { ok: true, data: data as Record<string, unknown> };
}

export function skalePixFromCreateResponse(data: Record<string, unknown>): {
  transactionId: string;
  qrCode: string;
  qrImageDataUrl: string;
} {
  const pix = (data.pix as Record<string, unknown> | undefined) || {};
  const qrCode = String(pix.qrcode || "");
  const img = pix.qrcodeImage;
  let qrImageDataUrl = "";
  if (typeof img === "string" && img) {
    if (img.startsWith("http://") || img.startsWith("https://")) {
      qrImageDataUrl = img;
    } else if (img.startsWith("data:")) {
      qrImageDataUrl = img;
    } else {
      qrImageDataUrl = `data:image/png;base64,${img}`;
    }
  }
  const transactionId = String(data.id || "");
  return { transactionId, qrCode, qrImageDataUrl };
}
