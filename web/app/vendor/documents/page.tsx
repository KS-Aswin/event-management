import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/app/api/_lib/auth";
import { findVendorByOwner } from "@/lib/db";
import { listOwnDocuments, type VendorDocument } from "@/lib/admin/documents";
import DocumentsManager from "./documents-manager";

export const metadata: Metadata = { title: "Business documents" };

// P1-10: private business documents for the "Verified business" badge. The
// vendor id comes from the session; files are never public.
export default async function VendorDocumentsPage() {
  const { session } = await requirePageRole("vendor");
  const vendor = await findVendorByOwner(session.userId);
  if (!vendor) redirect("/vendor/onboarding");

  let documents: VendorDocument[] | null = null;
  try {
    documents = await listOwnDocuments(vendor.id);
  } catch (err) {
    console.error("vendor documents", err);
  }

  return (
    <main className="page py-6 sm:py-8">
      <header className="mb-6 min-w-0">
        <h1 className="font-display text-heading font-semibold tracking-tight sm:text-display">Business documents</h1>
        <p className="mt-1 max-w-[62ch] text-lead text-ink-soft">
          Upload your GSTIN, trade licence, FSSAI or PAN. Once our team checks one, your profile can show the
          Verified business badge. Only Vela admins can open these files.
        </p>
      </header>
      {documents ? (
        <DocumentsManager initial={documents} />
      ) : (
        <div className="alert-error max-w-xl" role="alert">
          Could not load your documents. Refresh the page to try again.
        </div>
      )}
    </main>
  );
}
