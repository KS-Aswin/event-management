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
    <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\u003c") }}
      />
      <h1 className="text-display font-semibold mb-2">Help centre</h1>
      <p className="text-ink-soft text-sm mb-6">
        Answers to the most common questions. Can&apos;t find yours? Email help@vela.example.
      </p>
      {SECTIONS.map((section) => (
        <section key={section.id} aria-labelledby={section.id} className="mb-8">
          <h2 id={section.id} className="text-title font-semibold mb-1">
            {section.title}
          </h2>
          {section.faqs.map((f) => (
            <details key={f.id} id={f.id} className="group border-b border-line">
              <summary className="flex items-center justify-between gap-3 min-h-[44px] py-2.5 cursor-pointer list-none text-body font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-45 text-lg leading-none">
                  +
                </span>
              </summary>
              <p className="text-sm text-ink-soft leading-relaxed pb-3.5">{f.a}</p>
            </details>
          ))}
        </section>
      ))}
    </main>
  );
}
