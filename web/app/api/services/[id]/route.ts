import { NextResponse } from "next/server";
import { findCategories, isLastActiveService, removeService, updateService } from "@/lib/db";
import { getLiveSession } from "../../_lib/auth";
import { parseId } from "../../_lib/validation";
import { parseServiceBody } from "@/lib/service-validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const serviceId = parseId(id);
  if (serviceId === null) {
    return NextResponse.json({ error: "Invalid service id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = parseServiceBody(body, false);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.fields.category !== undefined) {
    const categories = await findCategories();
    if (!categories.includes(parsed.fields.category)) {
      return NextResponse.json({ error: "Please choose a valid category." }, { status: 400 });
    }
  }

  const service = await updateService(serviceId, session.userId, parsed.fields);
  if (!service) {
    // updateService refuses to deactivate the listing's last active service.
    if (parsed.fields.active === false && (await isLastActiveService(serviceId))) {
      return NextResponse.json(
        { error: "Your listing needs at least one active service. Add another before hiding this one." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Service not found, or you don't own it." },
      { status: 404 }
    );
  }
  return NextResponse.json({ service });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getLiveSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const serviceId = parseId(id);
  if (serviceId === null) {
    return NextResponse.json({ error: "Invalid service id." }, { status: 400 });
  }

  // Services that past enquiries refer to are hidden instead of deleted, so
  // leads keep showing what the customer asked for.
  const result = await removeService(serviceId, session.userId);
  if (!result.ok) {
    if (result.reason === "last_service") {
      return NextResponse.json(
        { error: "Your listing needs at least one service. Add another before removing this one." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Service not found, or you don't own it." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, mode: result.mode });
}
