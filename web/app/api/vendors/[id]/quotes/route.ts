import { NextResponse } from "next/server";
import { findVendorById, createQuoteRequest } from "@/lib/db";
import { getSession } from "@/lib/session";
import { notify } from "@/lib/notifications";
import { isDateUnavailable } from "@/lib/vendor-content";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { isValidDateString, todayString } from "@/lib/validate";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const limited = rateLimit(`quote:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "You've sent a lot of requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const vendor = await findVendorById(vendorId);
  if (!vendor || !vendor.published) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { name, phone, eventDate, budget, message } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (typeof phone !== "string" || !/^[0-9+\-\s()]{6,20}$/.test(phone.trim())) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  let eventDateValue: string | null = null;
  if (typeof eventDate === "string" && eventDate.trim()) {
    const d = eventDate.trim();
    if (!isValidDateString(d)) {
      return NextResponse.json({ error: "Please enter a valid event date." }, { status: 400 });
    }
    if (d < todayString()) {
      return NextResponse.json({ error: "The event date can't be in the past." }, { status: 400 });
    }
    if (await isDateUnavailable(vendorId, d)) {
      return NextResponse.json(
        { error: "This vendor isn't available on that date. Please pick another day." },
        { status: 409 }
      );
    }
    eventDateValue = d;
  }

  if (typeof budget === "string" && budget.length > 50) {
    return NextResponse.json({ error: "Budget is too long." }, { status: 400 });
  }
  if (typeof message === "string" && message.length > 2000) {
    return NextResponse.json({ error: "Message is too long (2000 characters max)." }, { status: 400 });
  }

  const session = await getSession();
  if (session && vendor.owner_id === session.userId) {
    return NextResponse.json(
      { error: "You can't request a quote from your own listing." },
      { status: 403 }
    );
  }

  const quote = await createQuoteRequest({
    vendorId,
    customerId: session?.userId ?? null,
    name: name.trim(),
    phone: phone.trim(),
    eventDate: eventDateValue,
    budget: typeof budget === "string" && budget.trim() ? budget.trim() : null,
    message: typeof message === "string" && message.trim() ? message.trim() : null,
  });

  if (vendor.owner_id) {
    await notify(vendor.owner_id, {
      type: "quote",
      title: `New quote request from ${name.trim()}`,
      body: eventDateValue ? `Event date: ${eventDateValue}` : undefined,
      link: `/dashboard/quotes/${quote.id}`,
    });
  }

  return NextResponse.json({ quote }, { status: 201 });
}
