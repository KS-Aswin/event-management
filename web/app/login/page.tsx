import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
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
  const session = await getSession();
  if (session) redirect(next);

  const email =
    typeof params.email === "string" ? params.email.slice(0, 254) : "";
  return <LoginForm next={next} initialEmail={email} />;
}
