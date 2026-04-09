import { instagramProfileLink, normalizeSmmLink, placeSmmOrderWithLink } from "./flame-smm.ts";

async function getSmmServiceId(supabase: any): Promise<string> {
  const { data, error } = await supabase.from("settings").select("value").eq("key", "smm_service_id").maybeSingle();
  if (error) console.warn("[fulfill] smm_service_id:", error.message);
  const v = data?.value?.trim();
  if (v) return v;
  console.warn("[fulfill] smm_service_id ausente na tabela settings — usando fallback 472");
  return "472";
}

async function getSmmLikesServiceId(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "smm_likes_service_id")
    .maybeSingle();
  if (error) console.warn("[fulfill] smm_likes_service_id:", error.message);
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
  if (error) console.warn("[fulfill] smm_views_service_id:", error.message);
  const v = data?.value?.trim();
  if (v) return v;
  return getSmmServiceId(supabase);
}

type OrderRow = {
  id: string;
  username: string;
  quantity: number;
  status: string;
  smm_order_id?: string | null;
  product_type?: string | null;
  post_url?: string | null;
};

/** Acima disso o PIX fica só em "paid" (sem chamada automática ao painel SMM). Até este valor: envio automático. */
export const SMM_AUTO_MAX_QUANTITY = 50_000;

/**
 * Após PIX confirmado: pedidos acima de SMM_AUTO_MAX_QUANTITY → paid; senão lock e pedido SMM.
 * Curtidas usam `post_url` e serviço `smm_likes_service_id`.
 */
export async function fulfillOrderAfterPixPaid(
  supabase: any,
  order: OrderRow,
  lockStatuses: string[],
): Promise<{ status: string }> {
  if (order.quantity > SMM_AUTO_MAX_QUANTITY) {
    await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", order.id)
      .in("status", ["waiting_payment", "unknown"]);
    return { status: "paid" };
  }

  const pt = (order.product_type || "followers").toLowerCase();
  const isLikes = pt === "likes";
  const isViews = pt === "views";
  const link = isLikes || isViews ? normalizeSmmLink(String(order.post_url || "").trim()) : null;

  if ((isLikes || isViews) && (!link || !link.includes("instagram.com"))) {
    await supabase
      .from("orders")
      .update({
        status: "paid",
        smm_last_error: isViews
          ? "Link do Reels/vídeo inválido ou ausente para visualizações."
          : "Link da publicação inválido ou ausente para curtidas.",
      })
      .eq("id", order.id)
      .in("status", lockStatuses);
    return { status: "paid" };
  }

  const { data: locked, error: lockErr } = await supabase
    .from("orders")
    .update({ status: "placing_smm" })
    .eq("id", order.id)
    .in("status", lockStatuses)
    .select()
    .single();

  if (lockErr || !locked) {
    return { status: order.status };
  }

  // Não enfileirar por username: antes colocava paid+queued, mas process-queue não roda em cron neste
  // projeto — pedidos ficavam para sempre sem chamar o painel SMM.

  const serviceId = isLikes
    ? await getSmmLikesServiceId(supabase)
    : isViews
      ? await getSmmViewsServiceId(supabase)
      : await getSmmServiceId(supabase);
  const smmLink = isLikes || isViews ? link! : instagramProfileLink(order.username);
  console.log(
    "[fulfill] FamaProvider add",
    JSON.stringify({ orderId: order.id, serviceId, qty: order.quantity, product_type: pt }),
  );
  const smmResult = await placeSmmOrderWithLink(smmLink, order.quantity, serviceId);

  if (smmResult.ok) {
    await supabase
      .from("orders")
      .update({
        status: "processing",
        smm_order_id: String(smmResult.order),
        smm_last_error: null,
      })
      .eq("id", order.id);
    return { status: "processing" };
  }

  // PIX já foi confirmado: manter "paid" no admin; detalhe do painel em smm_last_error.
  await supabase
    .from("orders")
    .update({
      status: "paid",
      smm_last_error: smmResult.reason.slice(0, 2000),
    })
    .eq("id", order.id);
  return { status: "paid" };
}
