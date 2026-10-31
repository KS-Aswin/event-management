import type { ClientListing } from "@/app/api/vendor/listing/_parse";
import type { Offering, PackageItem, TaxonomyLite } from "@/app/vendor/_components/offering-api";

export interface ServiceArea {
  district_id: number;
  district_name: string;
  travel_fee: number | null;
  travel_note: string | null;
}

export interface MediaCounts {
  images: number;
  videoFiles: number;
  videoLinks: number;
  albums: number;
}

export interface WizardData {
  listing: ClientListing | null;
  additionalCategoryIds: number[];
  serviceAreas: ServiceArea[];
  missing: string[];
  missingMessages: string[];
  media: MediaCounts | null;
  offerings: Offering[];
  packageItems: PackageItem[];
}

export interface StepProps {
  tax: TaxonomyLite;
  data: WizardData;
  setData: (fn: (d: WizardData) => WizardData) => void;
  /** PATCH (or POST when there is no listing yet) /api/vendor/listing; merges the response. */
  saveListing: (body: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string; field?: string }>;
  /** Marks this step done (saves onboarding_step) and moves on. */
  next: () => Promise<void>;
  back: () => void;
}

export const STEPS = [
  { n: 1, title: "About you", short: "About" },
  { n: 2, title: "What you offer", short: "Offer" },
  { n: 3, title: "Prices & packages", short: "Prices" },
  { n: 4, title: "Where you work", short: "Areas" },
  { n: 5, title: "Photos & videos", short: "Media" },
  { n: 6, title: "Review & submit", short: "Submit" },
] as const;
