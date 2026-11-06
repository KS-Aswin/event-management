import type { Metadata } from "next";
import Link from "next/link";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata: Metadata = {
  title: "Terms and content policy",
  description:
    "The rules for using Vela as a customer or vendor: content policy, media consent, reviews, verification documents, moderation and suspension.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "6 November 2026";

const SECTIONS = [
  { id: "using", label: "Using Vela" },
  { id: "customers", label: "For customers" },
  { id: "vendors", label: "For vendors" },
  { id: "content", label: "Content policy" },
  { id: "media", label: "Photos, videos and consent" },
  { id: "documents", label: "Verification documents" },
  { id: "reporting", label: "Reporting and moderation" },
  { id: "suspension", label: "Suspension and closing accounts" },
  { id: "law", label: "Governing law" },
  { id: "contact", label: "Contact" },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-title sm:text-heading font-semibold pt-8 text-foreground">
      {children}
    </h2>
  );
}

export default function TermsPage() {
  return (
    <main className="page-narrow py-10 sm:py-16">
      <p className="eyebrow text-accent mb-3">Policy</p>
      <h1 className="text-display sm:text-[32px] font-semibold mb-3">Terms and content policy</h1>
      <p className="text-ink-soft text-body mb-6">Last updated {UPDATED}</p>

      <p className="mb-8 max-w-[65ch] rounded-card border border-gold/40 bg-gold/10 px-4 py-3 text-body">
        <span className="font-semibold text-gold-ink">In short: </span>
        be honest, be respectful, only post what you have the right to post, and never use Vela to treat anyone
        differently because of their religion, caste or community.
      </p>

      <nav aria-labelledby="terms-toc" className="mb-4 rounded-card border border-line bg-surface-muted p-4 sm:p-5 max-w-[65ch]">
        <h2 id="terms-toc" className="text-body font-semibold">
          On this page
        </h2>
        <ol className="mt-2 grid gap-x-6 sm:grid-cols-2 list-decimal pl-5 text-[15px]">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-11 sm:min-h-9 items-center text-accent hover:underline underline-offset-2">
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-4 text-[16px] leading-[1.7] max-w-[65ch] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">
        <H2 id="using">1. Using Vela</H2>
        <p>
          Vela is a marketplace that helps people in Kerala find and contact wedding and event vendors. By creating an
          account or using the site you agree to these terms and to our{" "}
          <Link href="/privacy" className="text-accent underline underline-offset-2">
            Privacy policy
          </Link>
          . If you do not agree, please do not use Vela.
        </p>
        <ul>
          <li>You must be at least 18 years old to create an account.</li>
          <li>Give accurate details about yourself and keep your password private. You are responsible for what happens under your account.</li>
          <li>Do not scrape the site, send spam, try to get around security, or use Vela for anything illegal.</li>
          <li>Vela introduces customers and vendors. The agreement for an event is between the customer and the vendor, not with Vela.</li>
        </ul>

        <H2 id="customers">2. For customers</H2>
        <ul>
          <li>Send enquiries only for real events you are planning. Fake or bulk enquiries may be blocked.</li>
          <li>Prices on Vela are guides set by vendors. Confirm the final price, what is included and the advance in writing with the vendor before you pay.</li>
          <li>Pay vendors only after you are satisfied they are genuine. Report anything suspicious to us.</li>
          <li>Reviews must be about a real experience with that vendor. See the content policy below.</li>
        </ul>

        <H2 id="vendors">3. For vendors</H2>
        <ul>
          <li>Your listing must describe a real business that you own or are allowed to represent. Fake, duplicate or misleading listings are removed.</li>
          <li>Keep your prices, service areas and availability up to date, and reply to enquiries honestly.</li>
          <li>Use customers&apos; contact details only to answer their enquiry. Do not add them to marketing lists or share them without their consent.</li>
          <li>Listings go live only after the Vela team reviews them, and may be reviewed again when you make big changes.</li>
          <li>Do not offer customers anything in return for a review, and do not post reviews of your own business or a competitor.</li>
        </ul>

        <H2 id="content">4. Content policy</H2>
        <p>These rules apply to everything on Vela: listings, photos, videos, messages, quotes and reviews.</p>
        <ul>
          <li>
            <strong className="font-semibold">No discrimination.</strong> No communal, caste or religious remarks, and no refusing,
            ranking or pricing people differently because of their religion, caste, community, gender, disability or
            where they come from. Vendors may say which ceremonies or traditions they specialise in, but not who they will
            not serve.
          </li>
          <li>
            <strong className="font-semibold">No hate or harassment.</strong> No abuse, threats, slurs, sexual content or attacks on
            anyone.
          </li>
          <li>
            <strong className="font-semibold">Honest reviews only.</strong> Reviews must be your own, about a real experience, and
            fair. No paid, swapped, fake or copied reviews.
          </li>
          <li>
            <strong className="font-semibold">No personal data in reviews.</strong> Do not include phone numbers, email addresses,
            home addresses or other personal details of anyone, including the vendor&apos;s staff.
          </li>
          <li>
            <strong className="font-semibold">No fake listings.</strong> No made-up businesses, borrowed photos, false claims about
            awards or experience, or listings created to collect customers&apos; details.
          </li>
          <li>
            <strong className="font-semibold">No illegal content.</strong> Nothing that breaks Indian law or someone else&apos;s
            rights, including copyright.
          </li>
        </ul>

        <H2 id="media">5. Photos, videos and consent</H2>
        <p>When a vendor uploads a photo or video, or adds a video link, the vendor confirms that:</p>
        <ul>
          <li>they own it, or have the permission of whoever does (for example the photographer or the client);</li>
          <li>everyone who can be recognised in it has agreed to it being shown publicly, and for children a parent or guardian has agreed;</li>
          <li>it shows the vendor&apos;s own work and is not taken from another business or the internet.</li>
        </ul>
        <p>
          The vendor lets Vela show the media on Vela and in Vela&apos;s own listings and promotion of that vendor. Vela may
          review, crop, resize, hide or remove any media, for example after a report or a takedown request from the person
          in it. If you appear in a photo on Vela and want it removed, contact us and we will act quickly.
        </p>

        <H2 id="documents">6. Verification documents</H2>
        <p>
          Vendors may upload documents such as a GST certificate or ID to get a &ldquo;Verified&rdquo; badge. These documents are
          private: they are never shown on your listing or to customers, and only Vela administrators can see them, for
          verification. We keep them only as long as needed for that purpose and the law.
        </p>

        <H2 id="reporting">7. Reporting and moderation</H2>
        <ul>
          <li>Use the report option on a listing, photo or review to tell us about something that breaks these rules.</li>
          <li>Our team reviews reports and may hide or remove content, ask a vendor to make changes, or reject a listing. When we act on your content we tell you why where we can.</li>
          <li>If you think we made a mistake, reply to our message or contact us and we will look at it again.</li>
        </ul>

        <H2 id="suspension">8. Suspension and closing accounts</H2>
        <p>
          We may suspend or close an account, or unpublish a listing, if it breaks these terms, puts other users at risk, or
          if we are required to by law. Serious or repeated breaches, such as fake listings or discriminatory content, can
          lead to permanent removal. You can stop using Vela and ask us to close your account at any time.
        </p>

        <H2 id="law">9. Governing law</H2>
        <p>
          These terms are governed by the laws of India. Any dispute will be handled by the courts in Kerala. Vela provides the
          service as it is and is not responsible for the services a vendor provides; that is between the customer and the
          vendor. Nothing in these terms takes away rights you have under Indian consumer law.
        </p>
        <p>We may update these terms. When we make an important change we will update the date above and let account holders know.</p>

        <H2 id="contact">10. Contact</H2>
        <p>
          Questions, reports or takedown requests: email{" "}
          <a href={supportMailto()} className="text-accent underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          , see the{" "}
          <Link href="/help" className="text-accent underline underline-offset-2">
            Help page
          </Link>
          , or use the report option on the page concerned.
        </p>
      </div>
    </main>
  );
}
