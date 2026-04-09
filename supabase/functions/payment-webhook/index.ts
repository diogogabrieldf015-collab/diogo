import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fulfillOrderAfterPixPaid } from "../_shared/fulfill-after-payment.ts";
import { GATEWAY_SKALE, GATEWAY_X, orderPaymentGateway } from "../_shared/payment-gateway.ts";
import { parseSkaleNetAmountCentsFromPayload } from "../_shared/skale-amount.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getXMerchantKey(): string | null {
  return Deno.env.get("X_MERCHANT_KEY") ?? Deno.env.get("EXPAY_MERCHANT_KEY");
}

function getXApiBase(): string {
  return (Deno.env.get("X_API_BASE") ?? "https://expaybrasil.com").replace(/\/+$/, "");
}

async function checkXStatus(token: string, merchantKey: string): Promise<any> {
  const form = new URLSearchParams();
  form.set("token", token);
  form.set("merchant_key", merchantKey);

  const res = await fetch(`${getXApiBase()}/en/request/status`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  return await res.json();
}

/** Postback Skale: sem invoice_id/token da X; ver https://docs.skalepayments.com.br */
function isSkaleWebhookPayload(body: Record<string, unknown>): boolean {
  if (body.invoice_id || body.token) return false;
  if (typeof body.status !== "string") return false;
  const meta = body.metadata as Record<string, unknown> | undefined;
  if (meta?.order_id && typeof meta.order_id === "string") return true;
  if (typeof body.id === "string" && body.id.length > 0) return true;
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    console.log("Webhook received:", JSON.stringify(body));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (isSkaleWebhookPayload(body)) {
      const meta = body.metadata as Record<string, unknown> | undefined;
      const orderIdFromMeta = typeof meta?.order_id === "string" ? meta.order_id : "";
      const skaleTxnId = typeof body.id === "string" ? body.id : "";

      let order: any = null;
      if (orderIdFromMeta) {
        const r = await supabase.from("orders").select("*").eq("id", orderIdFromMeta).single();
        order = r.data;
      }
      if (!order && skaleTxnId) {
        const r = await supabase.from("orders").select("*").eq("transaction_hash", skaleTxnId).single();
        order = r.data;
      }

      if (!order) {
        console.error("Skale webhook: pedido não encontrado", { orderIdFromMeta, skaleTxnId });
        return new Response(JSON.stringify({ ok: false, error: "Order not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (orderPaymentGateway(order) !== GATEWAY_SKALE) {
        console.log(`Skale webhook ignorado: pedido ${order.id} é gateway "${order.payment_gateway}"`);
        return new Response(JSON.stringify({ ok: true, action: "ignored_wrong_gateway" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawStatus = String(body.status || "").toLowerCase();
      const isPaid = rawStatus === "paid";

      if (!isPaid) {
        if (rawStatus) {
          await supabase.from("orders").update({ status: rawStatus }).eq("id", order.id);
        }
        console.log(`Skale pedido ${order.id} status: ${rawStatus}`);
        return new Response(JSON.stringify({ ok: true, action: "status_updated" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (order.smm_order_id || order.status === "processing" || order.status === "completed") {
        return new Response(JSON.stringify({ ok: true, action: "already_processed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const netCents = parseSkaleNetAmountCentsFromPayload(body);
      if (netCents != null) {
        await supabase.from("orders").update({ amount_net_cents: netCents }).eq("id", order.id);
      }

      const { status } = await fulfillOrderAfterPixPaid(supabase, order, [
        "waiting_payment",
        "unknown",
        "paid",
      ]);

      return new Response(
        JSON.stringify({ ok: true, action: "fulfilled", status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ——— X (ExPay) ———
    const invoiceId = (body.invoice_id as string) || "";
    const token = (body.token as string) || "";

    if (!invoiceId && !token) {
      return new Response(JSON.stringify({ ok: false, error: "Payload não reconhecido (X ou Skale)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const X_MERCHANT_KEY = getXMerchantKey();
    if (!X_MERCHANT_KEY) {
      throw new Error("X_MERCHANT_KEY not configured");
    }

    let order: any = null;
    if (invoiceId) {
      const result = await supabase.from("orders").select("*").eq("id", invoiceId).single();
      order = result.data;
    }
    if (!order && token) {
      const result = await supabase.from("orders").select("*").eq("transaction_hash", token).single();
      order = result.data;
    }

    if (!order) {
      console.error("Order not found for invoice:", invoiceId, "token:", token);
      return new Response(JSON.stringify({ ok: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (orderPaymentGateway(order) !== GATEWAY_X) {
      console.log(`X webhook ignorado: pedido ${order.id} usa gateway "${order.payment_gateway}"`);
      return new Response(JSON.stringify({ ok: true, action: "ignored_wrong_gateway" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderToken = token || order.transaction_hash;
    let rawStatus = "";

    if (orderToken) {
      const statusData = await checkXStatus(orderToken, X_MERCHANT_KEY);
      console.log("X status response:", JSON.stringify(statusData));
      rawStatus = statusData?.transaction_request?.status || statusData?.status || statusData?.payment_status || "";
    }

    const isPaid = ["paid", "approved", "completed", "authorized", "verificando"].includes(
      rawStatus?.toString().toLowerCase(),
    );

    if (!isPaid) {
      await supabase
        .from("orders")
        .update({ status: rawStatus || "unknown" })
        .eq("id", order.id);
      return new Response(JSON.stringify({ ok: true, action: "status_updated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.smm_order_id || order.status === "processing" || order.status === "completed") {
      return new Response(JSON.stringify({ ok: true, action: "already_processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { status } = await fulfillOrderAfterPixPaid(supabase, order, [
      "waiting_payment",
      "unknown",
      "paid",
    ]);

    return new Response(
      JSON.stringify({ ok: true, action: "fulfilled", status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Webhook error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
