import type { VendorRecord } from "@/lib/db";

/** Client shape of the business profile (GET/PATCH /api/vendor/profile and the profile page). */
export function toProfile(v: VendorRecord, additionalCategoryIds: number[]) {
  return {
    id: v.id,
    status: v.status,
    name: v.name,
    vendorType: v.vendor_type,
    legalName: v.legal_name ?? null,
    primaryCategoryId: v.primary_category_id ?? null,
    additionalCategoryIds,
    about: v.about ?? "",
    yearsExperience: v.years_experience ?? null,
    yearEstablished: v.year_established ?? null,
    teamSize: v.team_size ?? null,
    languages: v.languages ?? [],
    tags: v.tags ?? [],
    phone: v.phone,
    whatsapp: v.whatsapp,
    districtId: v.district_id,
    location: v.location,
    addressLine: v.address_line ?? null,
    landmark: v.landmark ?? null,
    pincode: v.pincode ?? null,
    gstin: v.gstin ?? null,
    fssaiNo: v.fssai_no ?? null,
    instagramUrl: v.instagram_url ?? null,
    youtubeUrl: v.youtube_url ?? null,
    websiteUrl: v.website_url ?? null,
    travelOutsideKerala: !!v.travel_outside_kerala,
    maxEventsPerDay: v.max_events_per_day ?? 1,
    maxGuests: v.max_guests ?? null,
    rereviewRequired: !!v.rereview_required,
    rereviewFields: v.rereview_fields ?? [],
  };
}

export type VendorProfile = ReturnType<typeof toProfile>;
