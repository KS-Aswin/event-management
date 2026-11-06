import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/app/api/_lib/auth";
import type { VendorRecord } from "@/lib/db";
import {
  COMPARE_MAX,
  attributeValue,
  categoryAttributeFields,
  findCompareVendors,
  parseCompareIds,
  responseLabel,
  type AttributeField,
  type CompareVendor,
} from "@/lib/compare";
import { listShortlist } from "@/lib/shortlist";
import { getCategoryLabeller } from "@/lib/taxonomy";
import { findCardMedia } from "@/app/search/card-media";
import CardImage from "@/app/search/card-image";

export const metadata: Metadata = { title: "Compare vendors" };

// Compare (PRODUCT_PLAN P2-10): 2-4 vendors side by side. On phones only the
// table scrolls sideways (the label column stays pinned); the page never does.

type Row = { label: string; values: (string | null)[]; highlight?: number | null };

function bestIndex(nums: (number | null)[], lower: boolean): number | null {
  let best = -1;
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i];
    if (n === null) continue;
    const b = best === -1 ? null : nums[best];
    if (b === null || (lower ? n < b : n > b)) best = i;
  }
  // Only highlight when there is something to compare against.
  return best !== -1 && nums.filter((n) => n !== null).length >= 2 ? best : null;
}

/** The same "from" price search and the profile show (QA-036). */
function priceText(v: CompareVendor) {
  return v.priceLabel ?? "Price on request";
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { session } = await requirePageRole("customer");
  const sp = await searchParams;
  const parsed = parseCompareIds(sp.ids);

  if (!parsed.ok) return <CompareMessage title="Pick vendors to compare" body={`${parsed.error} Select 2 to ${COMPARE_MAX} vendors on your shortlist, then tap Compare.`} />;

  const [vendors, shortlist, categoryLabel] = await Promise.all([
    findCompareVendors(parsed.ids),
    listShortlist(session.userId),
    getCategoryLabeller(),
  ]);
  if (vendors.length < 2) {
    return (
      <CompareMessage
        title="Not enough vendors to compare"
        body="Some of these vendors are no longer available on Vela. Pick others from your shortlist."
      />
    );
  }
  const missing = parsed.ids.length - vendors.length;
  const notes = new Map(shortlist.map((s) => [s.vendorId, s.note]));

  // Key attributes only when every vendor is in the same category.
  const sharedCategory = vendors.every((v) => v.categoryId && v.categoryId === vendors[0].categoryId) ? vendors[0].categoryId : null;
  const fields: AttributeField[] = sharedCategory ? await categoryAttributeFields(sharedCategory) : [];
  const media = await findCardMedia(
    vendors.map((v) => ({ id: v.id, status: "approved", published: true, cover_media_id: v.coverMediaId, cover_image_url: v.coverImageUrl })) as unknown as VendorRecord[]
  );

  const sameUnit = vendors.every((v) => v.fromPrice !== null && v.fromUnit === vendors[0].fromUnit);
  const rows: Row[] = [
    {
      label: "Price",
      values: vendors.map(priceText),
      highlight: sameUnit ? bestIndex(vendors.map((v) => v.fromPrice), true) : null,
    },
    {
      label: "Rating",
      values: vendors.map((v) => (v.reviewsCount > 0 ? `★ ${v.rating.toFixed(1)} (${v.reviewsCount} review${v.reviewsCount === 1 ? "" : "s"})` : "No reviews yet")),
      highlight: bestIndex(vendors.map((v) => (v.reviewsCount > 0 ? v.rating : null)), false),
    },
    { label: "Verified business", values: vendors.map((v) => (v.verified ? "Yes" : "Not yet")) },
    {
      label: "Experience",
      values: vendors.map((v) => (v.yearsExperience !== null ? `${v.yearsExperience} year${v.yearsExperience === 1 ? "" : "s"}` : null)),
      highlight: bestIndex(vendors.map((v) => v.yearsExperience), false),
    },
    {
      label: "Usually replies",
      values: vendors.map((v) => responseLabel(v.responseMinutes)),
      highlight: bestIndex(vendors.map((v) => v.responseMinutes), true),
    },
    { label: "Category", values: vendors.map((v) => categoryLabel(v.category) || null) },
    { label: "Based in", values: vendors.map((v) => v.location || null) },
    { label: "Services offered", values: vendors.map((v) => (v.offeringCount ? String(v.offeringCount) : null)) },
    { label: "Team size", values: vendors.map((v) => (v.teamSize ? `${v.teamSize} people` : null)) },
    { label: "Largest event", values: vendors.map((v) => (v.maxGuests ? `${v.maxGuests.toLocaleString("en-IN")} guests` : null)) },
    { label: "Languages", values: vendors.map((v) => (v.languages.length ? v.languages.join(", ") : null)) },
    ...fields
      .map((f) => ({ label: f.label, values: vendors.map((v) => attributeValue(v.attributes[f.key])) }))
      .filter((r) => r.values.some((x) => x !== null)),
  ];
  if (vendors.some((v) => notes.get(v.id))) {
    rows.push({ label: "Your note", values: vendors.map((v) => notes.get(v.id) ?? null) });
  }

  return (
    <main className="page py-6 sm:py-8 min-w-0">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Compare vendors</h1>
          <p className="text-ink-soft text-lead mt-1">
            {vendors.length} vendors side by side{sharedCategory ? ` · ${categoryLabel(vendors[0].category)}` : ""}.
          </p>
        </div>
        <Link href="/my/shortlist" className="btn btn-secondary btn-sm">
          Back to shortlist
        </Link>
      </header>
      {missing > 0 && (
        <p role="status" className="alert-error mb-4">
          {missing === 1 ? "One vendor is" : `${missing} vendors are`} no longer available and {missing === 1 ? "was" : "were"} left out.
        </p>
      )}

      <div className="card p-0 overflow-hidden">
        {/* relative: the sr-only spans in the cells are position:absolute, so the
            scroller must be their containing block or they escape it and widen
            the whole page on phones (QA-012). */}
        <div className="relative overflow-x-auto overscroll-x-contain" role="region" aria-label="Comparison table" tabIndex={0}>
          <table className="w-full min-w-[560px] border-collapse text-body table-fixed">
            <caption className="sr-only">Comparison of {vendors.map((v) => v.name).join(", ")}</caption>
            <colgroup>
              <col className="w-[116px] sm:w-[180px]" />
              {vendors.map((v) => (
                <col key={v.id} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-line align-top">
                <td className="sticky left-0 z-10 bg-surface p-3 sm:p-4" />
                {vendors.map((v) => (
                  <th key={v.id} scope="col" className="p-3 sm:p-4 text-left font-normal">
                    <CardImage
                      src={media.get(v.id)?.src ?? null}
                      color={media.get(v.id)?.color ?? null}
                      category={v.category}
                      className="w-full h-24 sm:h-32 rounded-control!"
                    />
                    <Link href={`/vendors/${v.id}`} className="flex items-center min-h-11 mt-1 text-[15px] font-semibold leading-snug hover:underline underline-offset-2 hover:text-accent break-words">
                      {v.name}
                    </Link>
                    <Link
                      href={`/my/compare?ids=${parsed.ids.filter((id) => id !== v.id).join(",")}`}
                      className={`inline-flex items-center min-h-11 text-caption text-ink-soft hover:text-danger ${vendors.length <= 2 ? "invisible" : ""}`}
                      aria-hidden={vendors.length <= 2 ? true : undefined}
                      tabIndex={vendors.length <= 2 ? -1 : undefined}
                    >
                      Remove<span className="sr-only"> {v.name} from comparison</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line last:border-b-0 align-top">
                  <th scope="row" className="sticky left-0 z-10 bg-surface p-3 sm:p-4 text-left text-caption sm:text-body font-medium text-ink-soft shadow-[1px_0_0_var(--color-line)]">
                    {r.label}
                  </th>
                  {r.values.map((val, i) => (
                    <td key={vendors[i].id} className={`p-3 sm:p-4 break-words ${r.highlight === i ? "font-semibold text-accent-hover" : ""}`}>
                      {val ?? <span className="text-ink-soft">—</span>}
                      {r.highlight === i && <span className="sr-only"> (best)</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="align-top">
                <td className="sticky left-0 z-10 bg-surface p-3 sm:p-4" />
                {vendors.map((v) => (
                  <td key={v.id} className="p-3 sm:p-4">
                    <Link href={`/vendors/${v.id}`} className="btn btn-primary btn-sm w-full">
                      View &amp; get quote
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      {!sharedCategory && (
        <p className="hint mt-3">Category details appear when all the vendors you compare are in the same category.</p>
      )}
    </main>
  );
}

function CompareMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="page py-6 sm:py-8">
      <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight">Compare vendors</h1>
      <section className="card py-10 mt-5 text-center max-w-[52ch] mx-auto">
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-body text-ink-soft mt-1">{body}</p>
        <Link href="/my/shortlist" className="btn btn-primary mt-4">
          Go to shortlist
        </Link>
      </section>
    </main>
  );
}
