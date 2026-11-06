import Link from "next/link";
import { countOwnDocuments } from "@/lib/admin/documents";

/** Gentle nudge on the vendor home when no business document is uploaded yet (P1-10). */
export default async function DocumentsPrompt({ vendorId }: { vendorId: number }) {
  let n = 1;
  try {
    n = await countOwnDocuments(vendorId);
  } catch (err) {
    console.error("documents prompt", err);
  }
  if (n > 0) return null;
  return (
    <section
      aria-labelledby="docs-prompt-title"
      data-testid="documents-prompt"
      className="mt-4 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
    >
      <div className="min-w-0 flex-1">
        <h2 id="docs-prompt-title" className="font-semibold">
          Get the Verified business badge
        </h2>
        <p className="mt-0.5 text-body text-ink-soft">
          Upload your GSTIN, trade licence or FSSAI. Only our team sees it, and verified vendors earn more trust.
        </p>
      </div>
      <Link href="/vendor/documents" className="btn btn-secondary shrink-0">
        Upload a document
      </Link>
    </section>
  );
}
