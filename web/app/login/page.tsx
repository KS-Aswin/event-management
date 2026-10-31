import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveLiveSession, landingFor } from "@/app/api/_lib/auth";
import LoginForm from "./login-form";
import { safeNext } from "./safe-next";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
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

  const email =
    typeof params.email === "string" ? params.email.slice(0, 254) : "";
  const notice =
    params.suspended === "1"
      ? "This account is suspended. Contact support if you think this is a mistake."
      : null;
  return <LoginForm next={next} initialEmail={email} notice={notice} />;
}
