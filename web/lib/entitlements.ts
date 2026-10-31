// Plan limits (docs/PRODUCT_PLAN.md 4.2). While BILLING_ENABLED is not
// "true", every vendor gets Pro. Billing (005_billing.sql, P3) will read the
// vendor's subscription; until then the billing-on branch falls back to the
// free Starter plan so nothing is given away by accident.

export type PlanCode = "starter" | "pro" | "premium";

export interface VendorEntitlements {
  plan: PlanCode;
  billingEnabled: boolean;
  /** Gallery images (logo and cover do not count). null = unlimited. */
  maxImages: number | null;
  maxAlbums: number | null;
  maxVideoLinks: number | null;
  maxVideoFiles: number | null;
}

export const PLAN_LIMITS: Record<PlanCode, Omit<VendorEntitlements, "billingEnabled">> = {
  starter: { plan: "starter", maxImages: 10, maxAlbums: 2, maxVideoLinks: 2, maxVideoFiles: 0 },
  pro: { plan: "pro", maxImages: 50, maxAlbums: 10, maxVideoLinks: 10, maxVideoFiles: 3 },
  premium: { plan: "premium", maxImages: 200, maxAlbums: null, maxVideoLinks: 30, maxVideoFiles: 10 },
};

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "true";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getVendorEntitlements(vendorId: number): Promise<VendorEntitlements> {
  if (!isBillingEnabled()) return { ...PLAN_LIMITS.pro, billingEnabled: false };
  // TODO(P3 billing): look up the vendor's active subscription plan.
  return { ...PLAN_LIMITS.starter, billingEnabled: true };
}
