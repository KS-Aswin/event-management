import type { Metadata } from "next";
import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "How to get back into your Vela account if you forgot your password.",
};

// QA-007: account recovery without an email provider (free tools only for
// now). Support checks who is asking and sends a one-time reset link that an
// admin creates on /admin/users/<id>. When email is set up, this page gets a
// "send me a link" form instead.
// The address comes from lib/support.ts (SUPPORT_EMAIL env, QA-057).

export default function ForgotPasswordPage() {
  const subject = encodeURIComponent("Reset my Vela password");
  const body = encodeURIComponent(
    "Hi Vela team,\n\nI can't sign in. Please send me a password reset link.\n\nAccount email:\nName on the account:\nPhone number (if any):\nI'm a customer / vendor (business name):\n"
  );
  return (
    <main className="flex-1 flex items-start sm:items-center justify-center bg-surface-muted px-4 sm:px-5 py-8 sm:py-14">
      <div className="w-full max-w-[480px] bg-surface border border-line rounded-card shadow-card p-6 sm:p-10">
        <span aria-hidden="true" className="block h-1 w-10 rounded-full bg-gold mb-5" />
        <h1 className="font-display text-2xl sm:text-[26px] font-semibold text-foreground tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-soft mt-2">
          We&apos;ll help you back in. For your safety, a person on the Vela team checks the request before sending
          a reset link.
        </p>

        <ol className="mt-6 space-y-4 text-[15px] leading-relaxed">
          <li className="flex gap-3">
            <span aria-hidden="true" className="grid place-items-center size-7 shrink-0 rounded-full bg-accent-tint text-sm font-semibold text-accent-hover">
              1
            </span>
            <span>
              Email us from the address you signed up with, and tell us your name and, if you&apos;re a vendor, your
              business name.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="grid place-items-center size-7 shrink-0 rounded-full bg-accent-tint text-sm font-semibold text-accent-hover">
              2
            </span>
            <span>We check that the account is yours and reply with a private reset link, usually within one working day.</span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="grid place-items-center size-7 shrink-0 rounded-full bg-accent-tint text-sm font-semibold text-accent-hover">
              3
            </span>
            <span>
              Open the link within 24 hours and choose a new password. It works once, and signs you out on your other
              devices.
            </span>
          </li>
        </ol>

        <a href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`} className="btn btn-primary btn-block btn-lg mt-7">
          Email support
        </a>
        <p className="text-[13px] text-ink-soft mt-2 text-center break-all">{SUPPORT_EMAIL}</p>
        <p className="text-[13px] text-ink-soft mt-4">
          Sent an enquiry as a guest? You don&apos;t need a password for it: open the private link from your enquiry
          to see replies and offers.
        </p>

        <p className="text-center text-sm text-ink-soft mt-6 pt-5 border-t border-line">
          Remembered it?{" "}
          <Link
            href="/login"
            className="inline-flex items-center min-h-11 sm:min-h-0 text-accent font-medium hover:underline underline-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
