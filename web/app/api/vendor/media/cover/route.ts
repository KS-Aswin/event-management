import { setVendorImageRoute } from "@/lib/media/vendor-image";

/** {mediaId} sets the cover (null clears it); also writes vendors.cover_image_url. */
export async function PUT(request: Request) {
  return setVendorImageRoute(request, "cover");
}
