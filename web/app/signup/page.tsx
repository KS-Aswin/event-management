import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
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
  const session = await getSession();
  if (session) redirect(next);

  return <SignupForm next={next} initialRole={params.role === "vendor" ? "vendor" : "customer"} />;
}
