import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GATEWAY_SKALE, GATEWAY_X, getActivePaymentGateway } from "../_shared/payment-gateway.ts";
import {
  SKALE_MAX_CENTS,
  SKALE_MIN_CENTS,
  skaleCreatePix,
  skalePixFromCreateResponse,
} from "../_shared/skale-payments.ts";
import {
  computeChoppedPackagePrice,
  isChoppedPriceRpcUnavailable,
} from "../_shared/chopped-package-price.ts";
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
    const body = await req.json();
    const {
      username,
      quantity,
      amount,
      is_discounted,
      customer,
      product_type: rawProductType,
      post_url: rawPostUrl,
      parent_order_id: parentOrderId,
    } = body;
    const product_type =
      rawProductType === "likes" ? "likes" : rawProductType === "views" ? "views" : "followers";
    const post_url =
      (product_type === "likes" || product_type === "views") && typeof rawPostUrl === "string"
        ? rawPostUrl.trim()
        : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const paymentGateway = await getActivePaymentGateway(supabase);
    console.log("[create-payment] gateway ativo (settings):", paymentGateway);

    if (paymentGateway !== GATEWAY_X && paymentGateway !== GATEWAY_SKALE) {
      throw new Error(`Gateway "${paymentGateway}" não suportado.`);
    }

    if (product_type === "likes" || product_type === "views") {
      const u = post_url || "";
      if (!u || !u.toLowerCase().includes("instagram.com")) {
        throw new Error("Informe o link do Instagram (copiar link do post/Reels).");
      }
    }

    if (product_type === "followers") {
      const { data: minRow } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "smm_min_followers")
        .maybeSingle();
      const minQ = parseInt(String(minRow?.value ?? "").trim(), 10);
      const qty = Number(quantity);
      if (Number.isFinite(minQ) && minQ > 0 && Number.isFinite(qty) && qty < minQ) {
        throw new Error(
          `Este pacote (${qty} seguidores) é menor que o mínimo configurado para o painel (${minQ}). Escolha outro pacote ou ajuste em Admin → Seguidores → Qtd. mínima.`,
        );
      }
    }

    let resolvedAmountCents: number;
    if (product_type === "followers") {
      const qtyNum = Number(quantity);
      if (!Number.isFinite(qtyNum) || qtyNum < 1) {
        throw new Error("Quantidade de seguidores inválida.");
      }

      const followerServiceId = (Deno.env.get("FOLLOWERS_PACKAGE_SERVICE_ID") ?? "").trim() || null;

      const { data: chopRows, error: chopErr } = await supabase.rpc("compute_chopped_package_price", {
        p_requested_quantity: Math.round(qtyNum),
        p_kind: "followers",
        p_prefer_discount: Boolean(is_discounted),
        p_service_id: followerServiceId,
      });

      let cents: number = NaN;
      if (!chopErr && chopRows) {
        const chop = Array.isArray(chopRows) ? chopRows[0] : null;
        const raw = chop?.amount_cents;
        cents =
          raw == null
            ? NaN
            : typeof raw === "string"
              ? parseInt(raw, 10)
              : Number(raw);
      }

      if (Number.isFinite(cents) && cents >= 1) {
        resolvedAmountCents = cents;
      } else if (chopErr && !isChoppedPriceRpcUnavailable(chopErr)) {
        throw new Error(chopErr.message || "Erro ao calcular preço dos seguidores.");
      } else {
        const { data: pkgs, error: pkgErr } = await supabase
          .from("packages")
          .select("id, quantity, price, discount_price, kind, active")
          .eq("active", true);

        if (pkgErr) {
          throw new Error(pkgErr.message || "Erro ao buscar pacotes para cálculo.");
        }

        try {
          const chop = computeChoppedPackagePrice(
            pkgs ?? [],
            qtyNum,
            "followers",
            Boolean(is_discounted),
            followerServiceId,
          );
          resolvedAmountCents = chop.amount_cents;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Cálculo de preço falhou.";
          throw new Error(
            chopErr
              ? `${msg} (RPC: ${chopErr.message})`
              : msg,
          );
        }
      }

      if (!Number.isFinite(resolvedAmountCents) || resolvedAmountCents < 1) {
        throw new Error("Valor calculado inválido. Verifique os pacotes no Supabase.");
      }
    } else {
      resolvedAmountCents = Number(amount);
      if (!Number.isFinite(resolvedAmountCents) || resolvedAmountCents < 1) {
        throw new Error("Valor inválido.");
      }
    }

    const safeUsername =
      typeof username === "string" && username.trim() ? username.trim() : "instagram";

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        username: safeUsername,
        quantity,
        amount: resolvedAmountCents,
        is_discounted: is_discounted || false,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        customer_document: customer.document,
        payment_gateway: paymentGateway,
        product_type,
        post_url: product_type === "likes" || product_type === "views" ? post_url : null,
        parent_order_id:
          typeof parentOrderId === "string" && parentOrderId.length > 0 ? parentOrderId : null,
      })
      .select()
      .single();

    if (orderError) throw new Error(`Order creation failed: ${orderError.message}`);

    const notificationUrl = `${supabaseUrl}/functions/v1/payment-webhook`;

    if (paymentGateway === GATEWAY_SKALE) {
      if (resolvedAmountCents < SKALE_MIN_CENTS || resolvedAmountCents > SKALE_MAX_CENTS) {
        throw new Error(
          `Valor deve estar entre R$ ${(SKALE_MIN_CENTS / 100).toFixed(2)} e R$ ${(SKALE_MAX_CENTS / 100).toFixed(2)} (limite SkalePayments).`,
        );
      }

      const docDigits = String(customer.document || "").replace(/\D/g, "");
      if (docDigits.length < 11) {
        throw new Error("CPF/CNPJ inválido para SkalePayments.");
      }

      const skaleRes = await skaleCreatePix({
        amountCents: resolvedAmountCents,
        postbackUrl: notificationUrl,
        customer: {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          documentDigits: docDigits,
        },
        items: [
          {
            title:
              product_type === "likes"
                ? `Pacote ${quantity} curtidas — @${safeUsername}`
                : product_type === "views"
                  ? `Pacote ${quantity} visualizações — @${safeUsername}`
                  : `Pacote ${quantity} seguidores — @${safeUsername}`,
            unitPrice: resolvedAmountCents,
            quantity: 1,
            tangible: false,
            externalRef: order.id,
          },
        ],
        metadata: { order_id: order.id },
      });

      if (!skaleRes.ok) {
        const b = skaleRes.body as { error?: string; message?: string } | undefined;
        const detail =
          typeof b?.error === "string"
            ? b.error
            : typeof b?.message === "string"
              ? b.message
              : JSON.stringify(skaleRes.body);
        throw new Error(`SkalePayments [${skaleRes.status}]: ${detail}`);
      }

      const { transactionId, qrCode, qrImageDataUrl } = skalePixFromCreateResponse(skaleRes.data);
      if (!transactionId || !qrCode) {
        throw new Error(`SkalePayments: resposta sem PIX. ${JSON.stringify(skaleRes.data)}`);
      }

      let qrBase64Out = "";
      if (qrImageDataUrl.startsWith("data:image")) {
        const m = qrImageDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        qrBase64Out = m ? m[1] : "";
      }

      await supabase
        .from("orders")
        .update({
          transaction_hash: transactionId,
          pix_qr_code: qrCode,
          pix_qr_code_url: qrImageDataUrl || "",
          status: "waiting_payment",
        })
        .eq("id", order.id);

      return new Response(
        JSON.stringify({
          success: true,
          gateway: GATEWAY_SKALE,
          order_id: order.id,
          pix: {
            qr_code: qrCode,
            qr_code_base64: qrBase64Out,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ——— X (ExPay) ———
    const X_MERCHANT_KEY = getXMerchantKey();
    if (!X_MERCHANT_KEY) throw new Error("X_MERCHANT_KEY not configured");

    const priceInReais = (resolvedAmountCents / 100).toFixed(2);

    const isLikes = product_type === "likes";
    const isViews = product_type === "views";
    const invoice = {
      invoice_id: order.id,
      invoice_description: isLikes
        ? `${quantity} curtidas para publicação (@${safeUsername})`
        : isViews
          ? `${quantity} visualizações para publicação (@${safeUsername})`
          : `${quantity} seguidores para @${safeUsername}`,
      total: priceInReais,
      devedor: customer.name,
      email: customer.email,
      cpf_cnpj: customer.document.replace(/\D/g, ""),
      telefone: customer.phone.replace(/\D/g, ""),
      notification_url: notificationUrl,
      items: [
        {
          name: isLikes ? `Pacote ${quantity} curtidas` : isViews ? `Pacote ${quantity} visualizações` : `Pacote ${quantity} seguidores`,
          price: priceInReais,
          description: isLikes
            ? `Curtidas Instagram — link enviado pelo cliente`
            : isViews
              ? `Visualizações Instagram — link enviado pelo cliente`
              : `Seguidores Instagram para @${safeUsername}`,
          qty: "1",
        },
      ],
    };

    const formData = new URLSearchParams();
    formData.set("merchant_key", X_MERCHANT_KEY);
    formData.set("currency_code", "BRL");
    formData.set("invoice", JSON.stringify(invoice));

    console.log("X request invoice:", JSON.stringify(invoice));

    const paymentRes = await fetch(`${getXApiBase()}/en/purchase/link`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const paymentData = await paymentRes.json();
    console.log("X response:", JSON.stringify(paymentData));

    if (!paymentRes.ok) {
      throw new Error(`X API error [${paymentRes.status}]: ${JSON.stringify(paymentData)}`);
    }

    const pixRequest = paymentData?.pix_request;
    const pixCode = pixRequest?.pix_code?.emv || "";
    const qrcodeBase64 = pixRequest?.pix_code?.qrcode_base64 || "";
    const token = pixRequest?.transaction_id || "";

    await supabase
      .from("orders")
      .update({
        transaction_hash: token,
        pix_qr_code: pixCode,
        pix_qr_code_url: qrcodeBase64 ? `data:image/png;base64,${qrcodeBase64}` : "",
        status: "waiting_payment",
      })
      .eq("id", order.id);

    return new Response(
      JSON.stringify({
        success: true,
        gateway: GATEWAY_X,
        order_id: order.id,
        pix: {
          qr_code: pixCode,
          qr_code_base64: qrcodeBase64,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Create payment error:", msg);
    // HTTP 200 para o app receber o JSON no `data` (evita só "non-2xx" no cliente Supabase)
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
