import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fulfillOrderAfterPixPaid, SMM_AUTO_MAX_QUANTITY } from "../_shared/fulfill-after-payment.ts";
import {
  getSmmOrderStatus,
  instagramProfileLink,
  isSmmStatusTerminalDone,
  normalizeSmmLink,
  placeSmmOrderWithLink,
} from "../_shared/flame-smm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function getSmmServiceId(supabase: any): Promise<string> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "smm_service_id").maybeSingle();
  if (error) console.warn("[process-queue] smm_service_id:", error.message);
  const v = data?.value?.trim();
  return v || "472";
}

async function getSmmLikesServiceId(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "smm_likes_service_id")
    .maybeSingle();
  if (error) console.warn("[process-queue] smm_likes_service_id:", error.message);
  const v = data?.value?.trim();
  if (v) return v;
  return getSmmServiceId(supabase);
}

async function getSmmViewsServiceId(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "smm_views_service_id")
    .maybeSingle();
  if (error) console.warn("[process-queue] smm_views_service_id:", error.message);
  const v = data?.value?.trim();
  if (v) return v;
  return getSmmServiceId(supabase);
}

type QueuedOrderRow = {
  id: string;
  username: string;
  quantity: number;
  product_type?: string | null;
  post_url?: string | null;
};

/** paid+queued → envia ao painel SMM e atualiza linha. */
async function trySendQueuedOrderToSmm(supabase: any, next: QueuedOrderRow): Promise<"sent" | "error"> {
  const pt = (next.product_type || "followers").toLowerCase();
  const isLikes = pt === "likes";
  const isViews = pt === "views";
  const link = isLikes || isViews ? normalizeSmmLink(String(next.post_url || "").trim()) : null;
  if ((isLikes || isViews) && (!link || !link.includes("instagram.com"))) {
    await supabase
      .from("orders")
      .update({
        status: "paid",
        smm_last_error: isViews
          ? "Link do Reels/vídeo inválido ou ausente para visualizações."
          : "Link da publicação inválido ou ausente para curtidas.",
        queued: false,
      })
      .eq("id", next.id);
    return "error";
  }

  const serviceId = isLikes
    ? await getSmmLikesServiceId(supabase)
    : isViews
      ? await getSmmViewsServiceId(supabase)
      : await getSmmServiceId(supabase);
  const smmLink = isLikes || isViews ? link! : instagramProfileLink(next.username);
  const smmResult = await placeSmmOrderWithLink(smmLink, next.quantity, serviceId);

  if (smmResult.ok) {
    await supabase
      .from("orders")
      .update({
        status: "processing",
        queued: false,
        smm_order_id: String(smmResult.order),
        smm_last_error: null,
      })
      .eq("id", next.id);
    console.log(`Queued order ${next.id} → SMM ${smmResult.order}`);
    return "sent";
  }

  await supabase
    .from("orders")
    .update({
      status: "paid",
      smm_last_error: smmResult.reason.slice(0, 2000),
      queued: false,
    })
    .eq("id", next.id);
  console.error(`Queued order ${next.id} SMM falhou:`, smmResult.reason);
  return "error";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Check "processing" orders — update to "completed" if SMM is done
    const { data: processingOrders } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "processing")
      .not("smm_order_id", "is", null);

    let released = 0;

    for (const order of processingOrders || []) {
      const smmStatus = await getSmmOrderStatus(String(order.smm_order_id));

      if (isSmmStatusTerminalDone(smmStatus)) {
        await supabase
          .from("orders")
          .update({ status: "completed" })
          .eq("id", order.id);

        console.log(`Order ${order.id} completed (SMM: ${order.smm_order_id})`);

        // 2. Check if there's a queued order for same username
        const { data: queued } = await supabase
          .from("orders")
          .select("*")
          .eq("username", order.username)
          .eq("queued", true)
          .eq("status", "paid")
          .order("created_at", { ascending: true })
          .limit(1);

        if (queued && queued.length > 0) {
          const r = await trySendQueuedOrderToSmm(supabase, queued[0] as QueuedOrderRow);
          if (r === "sent") released++;
        }
      }
    }

    // 3. Fila antiga: paid+queued que nunca foi liberada (ex.: lógica antiga + sem cron)
    const { data: stuckQueued } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "paid")
      .eq("queued", true)
      .order("created_at", { ascending: true });

    for (const row of stuckQueued || []) {
      const r = await trySendQueuedOrderToSmm(supabase, row as QueuedOrderRow);
      if (r === "sent") released++;
    }

    // 4. Pago sem fila e sem SMM (ex.: regra antiga ≥10k): envia ao painel sem duplicar se já houve erro.
    let recoveredPaid = 0;
    const { data: stuckPaidNoSmm } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "paid")
      .eq("queued", false)
      .is("smm_order_id", null)
      .lte("quantity", SMM_AUTO_MAX_QUANTITY)
      .order("created_at", { ascending: true })
      .limit(15);

    for (const row of stuckPaidNoSmm || []) {
      const err = row.smm_last_error;
      if (err != null && String(err).trim() !== "") continue;
      const { status } = await fulfillOrderAfterPixPaid(supabase, row, [
        "paid",
        "waiting_payment",
        "unknown",
      ]);
      if (status === "processing") recoveredPaid++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checked: processingOrders?.length || 0,
        released,
        drained_stuck: (stuckQueued || []).length,
        recovered_paid_no_smm: recoveredPaid,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Queue error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
