import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { findVendorByOwner } from "@/lib/db";
import { listPortfolio } from "@/lib/vendor-content";
import PortfolioManager from "./portfolio-manager";

export default async function PortfolioPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "vendor") redirect("/dashboard");

  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/dashboard/create-listing");

  const items = await listPortfolio(vendor.id);
  const uploadsEnabled = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
  );

  return (
    <main className="max-w-[760px] mx-auto px-6 py-10 w-full">
      <h1 className="text-2xl font-semibold mb-1">Your portfolio</h1>
      <p className="text-ink-soft text-sm mb-6">
        Photos of your best work, shown on your public page (up to 24).
      </p>
      <PortfolioManager vendorId={vendor.id} initialItems={items} uploadsEnabled={uploadsEnabled} />
    </main>
  );
}
