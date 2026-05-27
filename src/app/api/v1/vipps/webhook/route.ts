import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type GenericWebhookPayload = Record<string, unknown> & {
  reference?: string;
  state?: string;
  agreementId?: string;
  eventType?: string;
};

const VIPPS_BASE_URL = process.env.VIPPS_BASE_URL ?? "https://apitest.vipps.no";

async function capturePayment(reference: string, tenant: { vippsSubKey: string | null }) {
  const accessToken = process.env.VIPPS_SERVER_TOKEN;
  const merchantSerialNumber = process.env.VIPPS_MSN;

  if (!accessToken || !tenant.vippsSubKey || !merchantSerialNumber) {
    throw new Error("Missing capture credentials");
  }

  const response = await fetch(`${VIPPS_BASE_URL}/epayment/v1/payments/${reference}/captures`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Merchant-Serial-Number": merchantSerialNumber,
      "Ocp-Apim-Subscription-Key": tenant.vippsSubKey,
      "Idempotency-Key": `capture-${reference}`,
    },
    body: JSON.stringify({ modificationAmount: undefined }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Capture failed (${response.status}): ${details}`);
  }
}

async function handleEcomEvent(payload: GenericWebhookPayload) {
  if (!payload.reference || !payload.state) return;

  const order = await prisma.order.findUnique({ where: { vippsOrderId: payload.reference }, include: { tenant: true } });
  if (!order) return;

  if (payload.state === "SUBMITTED" || payload.state === "RESERVED") {
    await prisma.order.update({ where: { vippsOrderId: payload.reference }, data: { status: "RESERVED", customerInfo: payload } });

    if (process.env.VIPPS_AUTO_CAPTURE === "true") {
      await capturePayment(payload.reference, order.tenant);
      await prisma.order.update({ where: { vippsOrderId: payload.reference }, data: { status: "CAPTURED" } });
    }
  }

  if (payload.state === "CAPTURED") {
    await prisma.order.update({ where: { vippsOrderId: payload.reference }, data: { status: "CAPTURED", customerInfo: payload } });
  }

  if (payload.state === "FAILED") {
    await prisma.order.update({ where: { vippsOrderId: payload.reference }, data: { status: "FAILED", customerInfo: payload } });
  }
}

async function handleRecurringEvent(payload: GenericWebhookPayload) {
  const agreementId = typeof payload.agreementId === "string" ? payload.agreementId : undefined;
  if (!agreementId) return;

  const statusByEvent: Record<string, "PENDING" | "ACTIVE" | "STOPPED" | "EXPIRED"> = {
    "agreement.activated": "ACTIVE",
    "agreement.stopped": "STOPPED",
    "agreement.expired": "EXPIRED",
  };

  const eventType = typeof payload.eventType === "string" ? payload.eventType : "";
  const nextStatus = statusByEvent[eventType];
  if (!nextStatus) return;

  await prisma.subscription.updateMany({ where: { vippsAgreementId: agreementId }, data: { status: nextStatus } });
}

async function handleCheckoutEvent(payload: GenericWebhookPayload) {
  if (payload.eventType !== "checkout.shipping.updated") return;
  // Placeholder multiplexer branch for shipping mutation workflows.
}

function detectDomain(payload: GenericWebhookPayload) {
  if (typeof payload.agreementId === "string" || `${payload.eventType ?? ""}`.startsWith("agreement.")) return "recurring";
  if (`${payload.eventType ?? ""}`.startsWith("checkout.")) return "checkout";
  if (payload.reference && payload.state) return "ecom";
  return "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-ms-signature") ?? req.headers.get("authorization");
    if (!signature) return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });

    const payload = (await req.json()) as GenericWebhookPayload;
    const domain = detectDomain(payload);

    if (domain === "ecom") await handleEcomEvent(payload);
    if (domain === "recurring") await handleRecurringEvent(payload);
    if (domain === "checkout") await handleCheckoutEvent(payload);

    return NextResponse.json({ ok: true, domain }, { status: 200 });
  } catch (error) {
    console.error("[Vipps webhook] handler failed", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
