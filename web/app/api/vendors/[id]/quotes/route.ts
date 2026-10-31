import { NextResponse } from "next/server";
import { findVendorById, createQuoteRequest, resolveEnquiryServices, addLeadUnits } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLiveSession } from "../../../_lib/auth";
import { LIMITS, normalisePhone, parseEventDate, parseId } from "../../../_lib/validation";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

function fieldError(field: string, error: string) {
  return NextResponse.json({ field, error }, { status: 400 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vendorId = parseId(id);
  if (vendorId === null) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const session = await getLiveSession();

  // Only publicly listed vendors take enquiries (the owner can still see a
  // pending listing, but can't send it quotes either).
  const vendor = await findVendorById(vendorId, { publicOnly: true });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  // 10 enquiries per 10 minutes per signed-in user or IP.
  const who = session ? `u:${session.userId}` : `ip:${clientIp(request)}`;
  if (!checkRateLimit(`quote:${who}`, 10, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, phone, eventDate, budget, message, serviceIds } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof name !== "string" || name.trim().length < 2) {
    return fieldError("name", "Please enter your name.");
  }
  if (name.trim().length > LIMITS.name) {
    return fieldError("name", `Name must be ${LIMITS.name} characters or fewer.`);
  }
  const cleanPhone = normalisePhone(phone);
  if (!cleanPhone) {
    return fieldError("phone", "Please enter a valid 10-digit mobile number.");
  }

  let cleanDate: string | null = null;
  if (eventDate !== undefined && eventDate !== null && eventDate !== "") {
    cleanDate = parseEventDate(eventDate);
    if (!cleanDate) {
      return fieldError("eventDate", "Please choose an event date from today up to three years ahead.");
    }
  }

  let cleanBudget: string | null = null;
  if (budget !== undefined && budget !== null && budget !== "") {
    if (typeof budget !== "string" || budget.trim().length > LIMITS.budget) {
      return fieldError("budget", `Budget must be ${LIMITS.budget} characters or fewer.`);
    }
    cleanBudget = budget.trim() || null;
  }

  let cleanMessage: string | null = null;
  if (message !== undefined && message !== null && message !== "") {
    if (typeof message !== "string" || message.trim().length > LIMITS.message) {
      return fieldError("message", `Message must be ${LIMITS.message} characters or fewer.`);
    }
    cleanMessage = message.trim() || null;
  }

  // Optional: which of this vendor's offerings the customer wants, either as
  // serviceIds: number[] or units: [{serviceId, qty?}]. Every id must be an
  // active, public offering of this vendor. A package-only unit can only be
  // asked for together with a package that includes it (PRODUCT_PLAN 3.2):
  // asking for package-only units alone is 400 PACKAGE_ONLY.
  const qtyById = new Map<number, number | null>();
  const pushId = (n: unknown, qty: unknown = null): boolean => {
    if (!Number.isInteger(n) || (n as number) <= 0 || (n as number) > 2147483647) return false;
    let q: number | null = null;
    if (qty !== null && qty !== undefined && qty !== "") {
      const v = Number(qty);
      if (!Number.isFinite(v) || v <= 0 || v > 100000) return false;
      q = Math.round(v * 100) / 100;
    }
    qtyById.set(n as number, q ?? qtyById.get(n as number) ?? null);
    return true;
  };
  const { units } = (body ?? {}) as Record<string, unknown>;
  if (serviceIds !== undefined && serviceIds !== null) {
    if (!Array.isArray(serviceIds) || serviceIds.length > 20 || !serviceIds.every((n) => pushId(n))) {
      return NextResponse.json({ error: "Invalid service selection.", code: "VALIDATION" }, { status: 400 });
    }
  }
  if (units !== undefined && units !== null) {
    if (
      !Array.isArray(units) ||
      units.length > 20 ||
      !units.every((u) => u && typeof u === "object" && pushId((u as Record<string, unknown>).serviceId, (u as Record<string, unknown>).qty))
    ) {
      return NextResponse.json({ error: "Invalid service selection.", code: "VALIDATION" }, { status: 400 });
    }
  }
  let requestedServiceIds: number[] = [];
  if (qtyById.size > 0) {
    if (qtyById.size > 20) {
      return NextResponse.json({ error: "Invalid service selection.", code: "VALIDATION" }, { status: 400 });
    }
    const resolved = await resolveEnquiryServices(vendorId, [...qtyById.keys()]);
    if (!resolved.ok) {
      return resolved.code === "PACKAGE_ONLY"
        ? NextResponse.json(
            {
              error: "That service is only available as part of a package. Choose a package that includes it.",
              code: "PACKAGE_ONLY",
            },
            { status: 400 }
          )
        : NextResponse.json(
            { error: "One or more selected services don't belong to this vendor.", code: "INVALID_SERVICE" },
            { status: 400 }
          );
    }
    requestedServiceIds = resolved.serviceIds;
  }

  const quote = await createQuoteRequest({
    vendorId,
    customerId: session?.userId ?? null,
    name: name.trim().replace(/\s+/g, " "),
    phone: cleanPhone,
    eventDate: cleanDate,
    budget: cleanBudget,
    message: cleanMessage,
    serviceIds: requestedServiceIds,
  });

  // Quantities (qty per unit) are stored on the same lead rows the vendor's
  // leads inbox reads (quote_request_services).
  const withQty = requestedServiceIds.filter((sid) => qtyById.get(sid) != null);
  if (withQty.length > 0) {
    await addLeadUnits(
      quote.id,
      vendorId,
      withQty.map((sid) => ({ serviceId: sid, qty: qtyById.get(sid) ?? null }))
    );
  }

  return NextResponse.json({ quote }, { status: 201 });
}
