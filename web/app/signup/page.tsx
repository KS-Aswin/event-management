import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveLiveSession, landingFor } from "@/app/api/_lib/auth";
import SignupForm from "./signup-form";
import { safeNext } from "../login/safe-next";

export const metadata: Metadata = {
  title: "Create account",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  // Already signed in: skip the form and go where the user was heading.
  // Live check, so a suspended or force-logged-out cookie shows the form
  // instead of bouncing between /login and the guarded area.
  const live = await resolveLiveSession();
  if (live.state === "ok") redirect(await landingFor(live.user, next));

  return <SignupForm next={next} initialRole={params.role === "vendor" ? "vendor" : "customer"} />;
}
