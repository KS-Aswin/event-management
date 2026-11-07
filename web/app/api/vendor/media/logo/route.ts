import { setVendorImageRoute } from "@/lib/media/vendor-image";

/** {mediaId} sets the logo (null clears it); also writes vendors.logo_url. */
export async function PUT(request: Request) {
  return setVendorImageRoute(request, "logo");
}
