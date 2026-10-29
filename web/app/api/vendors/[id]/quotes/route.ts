import { NextResponse } from "next/server";
import { findVendorById, createQuoteRequest, findServicesByVendor } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const vendor = await findVendorById(vendorId);
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
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
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (typeof phone !== "string" || phone.trim().length < 6) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
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

  const session = await getSession();

  const quote = await createQuoteRequest({
    vendorId,
    customerId: session?.userId ?? null,
    name: name.trim(),
    phone: phone.trim(),
    eventDate: typeof eventDate === "string" && eventDate ? eventDate : null,
    budget: typeof budget === "string" && budget ? budget : null,
    message: typeof message === "string" && message ? message : null,
    serviceIds: requestedServiceIds,
  });

  return NextResponse.json({ quote }, { status: 201 });
}
