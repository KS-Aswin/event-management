import type { Metadata } from "next";
import { requirePageRole } from "@/app/api/_lib/auth";
import { categoryLabeller, getTaxonomy } from "@/lib/taxonomy";
import type { Taxonomy, VendorRecord } from "@/lib/db";
import { findEnquiryDefaults, listShortlist } from "@/lib/shortlist";
import { listCustomerEnquiries } from "@/lib/enquiry-thread";
import { OPEN_ENQUIRY_STATUSES } from "@/lib/enquiries-create";
import { findCardMedia } from "@/app/search/card-media";
import ShortlistBoard, { type BoardItem } from "./shortlist-board";

export const metadata: Metadata = { title: "Shortlist" };

// Shortlist (PRODUCT_PLAN P2-9, 2.3): saved vendors grouped by category with
// private notes; select up to 5 to send one enquiry to all of them
// (POST /api/enquiries/multi), or 2-4 to compare side by side.

async function loadTaxonomy(): Promise<Taxonomy | null> {
  try {
    return await getTaxonomy();
  } catch {
    return null;
  }
}

export default async function ShortlistPage() {
  const { session, user } = await requirePageRole("customer");
  const phone = (user as { phone_e164?: string | null }).phone_e164 ?? "";
  const [items, taxonomy, enquiries, defaults] = await Promise.all([
    listShortlist(session.userId),
    loadTaxonomy(),
    listCustomerEnquiries(session.userId),
    // The send sheet starts from what the customer already told vendors (QA-029).
    findEnquiryDefaults(session.userId, { name: session.name, phone }),
  ]);
  const media = await findCardMedia(
    items
      .filter((i) => i.available)
      .map((i) => ({ id: i.vendorId, status: "approved", published: true, cover_media_id: i.coverMediaId, cover_image_url: i.coverImageUrl })) as unknown as VendorRecord[]
  );

  // Latest live enquiry per vendor, so the list can say "Enquiry sent".
  const enquired = new Map<number, number>();
  for (const e of enquiries) {
    if (["withdrawn", "expired", "declined"].includes(e.status)) continue;
    if (!enquired.has(e.vendor.id)) enquired.set(e.vendor.id, e.id);
  }

  // Dates of the customer's open enquiries per vendor: the send sheet must not
  // prefill a date every selected vendor would refuse as a duplicate (QA-063).
  const openDates = new Map<number, string[]>();
  for (const e of enquiries) {
    if (!e.eventDate || !(OPEN_ENQUIRY_STATUSES as readonly string[]).includes(e.status)) continue;
    openDates.set(e.vendor.id, [...(openDates.get(e.vendor.id) ?? []), e.eventDate]);
  }

  const board: BoardItem[] = items.map((i) => ({
    ...i,
    openEnquiryDates: openDates.get(i.vendorId) ?? [],
    image: media.get(i.vendorId)?.src ?? null,
    color: media.get(i.vendorId)?.color ?? null,
    enquiryId: enquired.get(i.vendorId) ?? null,
  }));
  const categoryOrder = taxonomy?.categories.map((c) => c.name) ?? [];
  const label = categoryLabeller(taxonomy);
  const categoryLabels = Object.fromEntries(items.map((i) => [i.category, label(i.category)]));

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Shortlist</h1>
        <p className="text-ink-soft text-lead mt-1 max-w-[62ch]">
          {items.length === 0
            ? "Vendors you save show up here."
            : `${items.length} saved vendor${items.length === 1 ? "" : "s"}. Select up to 5 to send them one enquiry, or 2 to 4 to compare.`}
        </p>
      </header>
      <ShortlistBoard
        items={board}
        categoryOrder={categoryOrder}
        categoryLabels={categoryLabels}
        eventTypes={taxonomy?.eventTypes.map((e) => ({ id: e.id, name: e.name })) ?? []}
        districts={taxonomy?.districts.map((d) => ({ id: d.id, name: d.name })) ?? []}
        defaults={defaults}
      />
    </main>
  );
}
