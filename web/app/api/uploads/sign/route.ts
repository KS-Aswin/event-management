import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSession } from "@/lib/session";

// Gives a signed-in vendor a short-lived signature so their browser can upload
// a photo straight to Cloudinary (the file never passes through our server and
// the API secret never reaches the browser). Needs CLOUDINARY_CLOUD_NAME,
// CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET; without them uploads are off
// and vendors can paste an image link instead.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "vendor") {
    return NextResponse.json({ error: "Only vendor accounts can upload photos." }, { status: 403 });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return NextResponse.json({ error: "Photo uploads aren't set up yet." }, { status: 503 });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `vela/vendor-${session.userId}`;
  // Cloudinary signs the alphabetically sorted params, then the secret.
  const signature = createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  return NextResponse.json({ cloudName, apiKey, timestamp, folder, signature });
}
