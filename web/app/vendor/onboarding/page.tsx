import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePageRole } from "@/app/api/_lib/auth";
import {
  countMediaByVendor,
  findListingMissing,
  findVendorCategoryIds,
  findVendorServiceAreas,
  getOwnVendor,
} from "@/lib/db";
import { getTaxonomy } from "@/lib/taxonomy";
import { MISSING_MESSAGES, toClientListing } from "@/app/api/vendor/listing/_parse";
import { listPayload } from "@/app/api/vendor/offerings/_lib";
import type { TaxonomyLite, Offering } from "@/app/vendor/_components/offering-api";
import OnboardingWizard from "./wizard";
import type { WizardData } from "./types";

export const metadata: Metadata = { title: "Set up your listing" };

// /vendor/onboarding?step=1..6 (P0-10). Loads everything the wizard needs on
// the server; without ?step it resumes at the saved onboarding_step.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { session } = await requirePageRole("vendor");
  const [vendor, taxonomy] = await Promise.all([getOwnVendor(session.userId), getTaxonomy()]);

  const tax: TaxonomyLite = {
    categories: taxonomy.categories,
    templates: taxonomy.templates,
    eventTypes: taxonomy.eventTypes.map((e) => ({ id: e.id, name: e.name })),
    districts: taxonomy.districts.map((d) => ({ id: d.id, name: d.name })),
    priceUnits: taxonomy.priceUnits,
  } as TaxonomyLite;

  let initial: WizardData = {
    listing: null,
    additionalCategoryIds: [],
    serviceAreas: [],
    missing: [],
    missingMessages: [],
    media: null,
    offerings: [],
    packageItems: [],
  };
  if (vendor) {
    const [additionalCategoryIds, serviceAreas, missing, media, offers] = await Promise.all([
      findVendorCategoryIds(vendor.id),
      findVendorServiceAreas(vendor.id),
      findListingMissing(vendor.id),
      countMediaByVendor(vendor.id),
      listPayload(vendor.id),
    ]);
    initial = {
      listing: JSON.parse(JSON.stringify(toClientListing(vendor))),
      additionalCategoryIds,
      serviceAreas,
      missing,
      missingMessages: missing.map((m) => MISSING_MESSAGES[m] ?? m),
      media,
      offerings: JSON.parse(JSON.stringify(offers.offerings)) as Offering[],
      packageItems: JSON.parse(JSON.stringify(offers.packageItems)),
    };
  }

  const reached = vendor ? Math.min(Math.max(Number(vendor.onboarding_step) || 1, 1), 6) : 1;
  const sp = await searchParams;
  const asked = Number(Array.isArray(sp.step) ? sp.step[0] : sp.step);
  const initialStep = asked >= 1 && asked <= 6 ? Math.min(asked, reached) : reached;

  return (
    <Suspense>
      <OnboardingWizard tax={tax} initial={initial} initialStep={initialStep} />
    </Suspense>
  );
}
