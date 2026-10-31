import { NextResponse } from "next/server";
import { findVendorById, createQuoteRequest, findServicesByVendor } from "@/lib/db";
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

  // Optional: which of this vendor's services the customer wants. Every id
  // must be a service this vendor actually offers.
  let requestedServiceIds: number[] = [];
  if (serviceIds !== undefined) {
    if (
      !Array.isArray(serviceIds) ||
      serviceIds.length > 20 ||
      !serviceIds.every((n) => Number.isInteger(n))
    ) {
      return NextResponse.json({ error: "Invalid service selection." }, { status: 400 });
    }
    const offered = await findServicesByVendor(vendorId);
    const offeredIds = new Set(offered.map((s) => s.id));
    if (!(serviceIds as number[]).every((n) => offeredIds.has(n))) {
      return NextResponse.json(
        { error: "One or more selected services don't belong to this vendor." },
        { status: 400 }
      );
    }
    requestedServiceIds = Array.from(new Set(serviceIds as number[]));
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

  return NextResponse.json({ quote }, { status: 201 });
}
