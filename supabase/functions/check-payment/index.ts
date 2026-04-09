import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fulfillOrderAfterPixPaid, SMM_AUTO_MAX_QUANTITY } from "../_shared/fulfill-after-payment.ts";
import { GATEWAY_SKALE, GATEWAY_X, orderPaymentGateway } from "../_shared/payment-gateway.ts";
import { getSmmOrderStatus, isSmmStatusTerminalDone } from "../_shared/flame-smm.ts";
import { parseSkaleNetAmountCentsFromPayload } from "../_shared/skale-amount.ts";
import { skaleGetTransaction } from "../_shared/skale-payments.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id } = await req.json();

    if (!order_id) {
      return new Response(JSON.stringify({ ok: false, error: "Missing order_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ ok: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pedido no SMM: sincroniza conclusão (o cron process-queue muitas vezes não está agendado).
    if (order.status === "processing" && order.smm_order_id) {
      const smm = await getSmmOrderStatus(String(order.smm_order_id));
      if (isSmmStatusTerminalDone(smm)) {
        await supabase.from("orders").update({ status: "completed" }).eq("id", order.id);
        return new Response(JSON.stringify({ ok: true, status: "completed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const qty = Number(order.quantity);
    const noSmmError = order.smm_last_error == null || String(order.smm_last_error).trim() === "";
    const stuckPaidNeedsSmm =
      order.status === "paid" &&
      !order.smm_order_id &&
      noSmmError &&
      Number.isFinite(qty) &&
      qty > 0 &&
      qty <= SMM_AUTO_MAX_QUANTITY;

    if (stuckPaidNeedsSmm) {
      const { status } = await fulfillOrderAfterPixPaid(supabase, order, [
        "paid",
        "waiting_payment",
        "unknown",
      ]);
      return new Response(JSON.stringify({ ok: true, status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Inclui placing_smm e smm_error: PIX já foi reconhecido; o front não pode ficar em loading eterno.
    if (
      ["processing", "completed", "paid", "placing_smm", "smm_error"].includes(order.status)
    ) {
      return new Response(JSON.stringify({ ok: true, status: order.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gateway = orderPaymentGateway(order);

    if (gateway === GATEWAY_SKALE) {
      if (!order.transaction_hash) {
        return new Response(JSON.stringify({ ok: true, status: order.status }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sk = await skaleGetTransaction(order.transaction_hash);
      if (!sk.ok) {
        console.error("Skale get transaction:", sk.status, sk.body);
        return new Response(JSON.stringify({ ok: true, status: order.status }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const st = String(sk.data.status || "").toLowerCase();
      const isPaid = st === "paid";

      const netFromApi = parseSkaleNetAmountCentsFromPayload(sk.data as Record<string, unknown>);
      if (netFromApi != null) {
        await supabase.from("orders").update({ amount_net_cents: netFromApi }).eq("id", order.id);
      }

      if (
        isPaid &&
        !order.smm_order_id &&
        order.status !== "processing" &&
        order.status !== "completed" &&
        order.status !== "paid" &&
        order.status !== "placing_smm"
      ) {
        const { status } = await fulfillOrderAfterPixPaid(supabase, order, ["waiting_payment", "unknown"]);
        return new Response(JSON.stringify({ ok: true, status }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (st && st !== order.status && ["waiting_payment", "refused", "cancelled", "refunded"].includes(st)) {
        await supabase.from("orders").update({ status: st }).eq("id", order.id);
      }

      return new Response(JSON.stringify({ ok: true, status: st || order.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (gateway !== GATEWAY_X) {
      return new Response(JSON.stringify({ ok: true, status: order.status, gateway }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const X_MERCHANT_KEY = getXMerchantKey();
    if (!X_MERCHANT_KEY || !order.transaction_hash) {
      return new Response(JSON.stringify({ ok: true, status: order.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const form = new URLSearchParams();
    form.set("token", order.transaction_hash);
    form.set("merchant_key", X_MERCHANT_KEY);

    const xRes = await fetch(`${getXApiBase()}/en/request/status`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const xData = await xRes.json();
    console.log(`X status response for ${order.transaction_hash}:`, JSON.stringify(xData));

    const xStatus = (xData.transaction_request?.status || xData.status || "").toString().toLowerCase();
    const isPaid = ["paid", "approved", "completed", "authorized", "verificando"].includes(xStatus);

    if (
      isPaid &&
      !order.smm_order_id &&
      order.status !== "processing" &&
      order.status !== "completed" &&
      order.status !== "paid" &&
      order.status !== "placing_smm"
    ) {
      const { status } = await fulfillOrderAfterPixPaid(supabase, order, ["waiting_payment", "unknown"]);
      return new Response(JSON.stringify({ ok: true, status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (xStatus && xStatus !== order.status) {
      await supabase.from("orders").update({ status: xStatus }).eq("id", order.id);
    }

    return new Response(JSON.stringify({ ok: true, status: xStatus || order.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Check payment error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
