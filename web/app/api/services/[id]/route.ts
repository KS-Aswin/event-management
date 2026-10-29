import { NextResponse } from "next/server";
import { deleteService, findCategories, updateService } from "@/lib/db";
import { getSession } from "@/lib/session";
import { parseServiceBody } from "@/lib/service-validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const serviceId = parseInt(id, 10);
  if (Number.isNaN(serviceId)) {
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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const serviceId = parseInt(id, 10);
  if (Number.isNaN(serviceId)) {
    return NextResponse.json({ error: "Invalid service id." }, { status: 400 });
  }

  const deleted = await deleteService(serviceId, session.userId);
  if (!deleted) {
    return NextResponse.json(
      { error: "Service not found, or you don't own it." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
