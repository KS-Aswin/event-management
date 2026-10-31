import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help centre",
  description: "Answers to common questions about finding vendors and listing your business on Vela.",
  alternates: { canonical: "/help" },
};

interface Faq {
  id: string;
  q: string;
  a: string;
}

const CUSTOMER_FAQS: Faq[] = [
  {
    id: "request-quote",
    q: "How do I request a quote from a vendor?",
    a: 'Open any vendor\'s profile and tap "Request quote." Fill in your event date, budget and a short message. The vendor sees your request in their dashboard and replies to you directly.',
  },
  {
    id: "vendor-checks",
    q: "Does Vela verify vendors?",
    a: "Not yet. Vela doesn't currently check vendors' business registration or bookings. Before you book, read the vendor's customer reviews, look through their portfolio, and confirm details such as price and availability with them directly.",
  },
  {
    id: "is-it-free",
    q: "Is it free to use Vela as a customer?",
    a: "Yes. Searching, comparing vendors and requesting quotes is free. You pay vendors directly for their services.",
  },
];

const VENDOR_FAQS: Faq[] = [
  {
    id: "list-business",
    q: "How do I list my business on Vela?",
    a: 'Go to "For vendors", choose "I\'m a vendor" when creating your account, and fill in your business profile, services and prices.',
  },
  {
    id: "quote-requests",
    q: "Where do I see quote requests?",
    a: "Quote requests from customers appear as leads in your dashboard, where you can update each one's status as you reply.",
  },
];

const SECTIONS = [
  { id: "customers", title: "For customers", faqs: CUSTOMER_FAQS },
  { id: "vendors", title: "For vendors", faqs: VENDOR_FAQS },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [...CUSTOMER_FAQS, ...VENDOR_FAQS].map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function HelpPage() {
  return (
    <main className="page-narrow py-10 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\u003c") }}
      />
      <p className="eyebrow text-accent mb-3">Support</p>
      <h1 className="text-display sm:text-[32px] font-semibold mb-3">Help centre</h1>
      <p className="text-ink-soft text-[16px] leading-relaxed mb-10 max-w-[60ch]">
        Answers to the most common questions. Can&apos;t find yours? Email{" "}
        <a
          href="mailto:help@vela.example"
          className="text-accent font-medium underline-offset-2 hover:underline"
        >
          help@vela.example
        </a>
        .
      </p>
      {SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={section.id} className="mb-10">
          <h2 id={section.id} className="text-title font-semibold mb-3">
            {section.title}
          </h2>
          <div className="rounded-card border border-line bg-surface divide-y divide-line overflow-hidden">
            {section.faqs.map((f) => (
              <details key={f.id} id={f.id} className="group">
                <summary className="flex items-center justify-between gap-4 min-h-[56px] px-4 sm:px-5 py-3 cursor-pointer list-none text-[15.5px] font-semibold transition-colors hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="grid shrink-0 place-items-center w-7 h-7 rounded-full bg-surface-muted text-ink-soft text-lg leading-none transition-transform group-open:rotate-45 group-open:bg-accent-tint group-open:text-accent motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="px-4 sm:px-5 pb-4 pr-12 sm:pr-14 text-[15px] text-ink-soft leading-relaxed max-w-[65ch]">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
