import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveLiveSession, landingFor } from "@/app/api/_lib/auth";
import { enquiryTokenFrom } from "./enquiry-token";
import LoginForm from "./login-form";
import ClaimEnquiry from "./claim-enquiry";
import { safeNext } from "./safe-next";

export const metadata: Metadata = {
  title: "Sign in",
};

const SUSPENDED_GENERIC = "This account is suspended. Contact support if you think this is a mistake.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const enquiryToken = enquiryTokenFrom(params, next);

  // Already signed in: skip the form and go where the user was heading.
  // Live check, so a suspended or force-logged-out cookie shows the form
  // instead of bouncing between /login and the guarded area.
  const live = await resolveLiveSession();
  if (live.state === "ok") {
    // A signed-in customer who followed "add to my account" from a guest
    // enquiry link: ask before adding it (never on a plain page load).
    if (enquiryToken && live.user.role === "customer") return <ClaimEnquiry token={enquiryToken} />;
    redirect(await landingFor(live.user, next));
  }

  // Set by proxy.ts from the (now cleared) cookie of a suspended user: it
  // carries the reason the admin gave (QA-031).
  let suspension: string | null = null;
  const raw = (await headers()).get("x-vela-suspension");
  if (raw) {
    try {
      suspension = decodeURIComponent(raw).slice(0, 700);
    } catch {
      suspension = null;
    }
  }

  const email =
    typeof params.email === "string" ? params.email.slice(0, 254) : "";
  const notice = suspension ?? (params.suspended === "1" ? SUSPENDED_GENERIC : null);
  return <LoginForm next={next} initialEmail={email} notice={notice} enquiryToken={enquiryToken} />;
}
