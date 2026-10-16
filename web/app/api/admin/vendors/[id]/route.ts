import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { setVendorFlags } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const vendorId = parseInt(id, 10);
  if (Number.isNaN(vendorId)) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { verified, featured, published } = (body ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries({ verified, featured, published })) {
    if (value !== undefined && typeof value !== "boolean") {
      return NextResponse.json({ error: `"${key}" must be true or false.` }, { status: 400 });
    }
  }

  const vendor = await setVendorFlags(vendorId, {
    verified: verified as boolean | undefined,
    featured: featured as boolean | undefined,
    published: published as boolean | undefined,
  });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }
  return NextResponse.json({ vendor });
}
