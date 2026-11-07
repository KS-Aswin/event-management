import type { Metadata } from "next";
import Link from "next/link";
import { checkResetToken } from "@/lib/password-reset";
import ResetForm from "./reset-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

// QA-007: the page behind a one-time reset link an admin created
// (/admin/users/<id>). proxy.ts marks it no-store and no-referrer.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const check = token ? await checkResetToken(token) : ({ ok: false } as const);

  return (
    <main className="flex-1 flex items-start sm:items-center justify-center bg-surface-muted px-4 sm:px-5 py-8 sm:py-14">
      <div className="w-full max-w-[440px] bg-surface border border-line rounded-card shadow-card p-6 sm:p-10">
        <span aria-hidden="true" className="block h-1 w-10 rounded-full bg-gold mb-5" />
        {check.ok ? (
          <ResetForm token={token} name={check.name} />
        ) : (
          <>
            <h1 className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight">
              This link doesn&apos;t work
            </h1>
            <p className="text-[15px] leading-relaxed text-ink-soft mt-2">
              Reset links work once and expire after 24 hours. This one is invalid, already used or expired.
            </p>
            <Link href="/forgot-password" className="btn btn-primary btn-block btn-lg mt-6">
              Get a new link
            </Link>
            <Link href="/login" className="btn btn-secondary btn-block mt-2.5">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
