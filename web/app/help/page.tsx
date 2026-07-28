const FAQS = [
  {
    q: "How do I request a quote from a vendor?",
    a: 'Open any vendor\'s profile and tap "Request quote." Fill in your event date, budget, and a short message — the vendor typically replies within a few hours.',
  },
  {
    q: "How are vendors verified?",
    a: "Verified vendors have confirmed their business registration and completed at least one booking through Vela with a reviewed customer. Look for the green \"Verified\" badge on a profile.",
  },
  {
    q: "Is it free to use Vela as a customer?",
    a: "Yes. Searching, comparing vendors, and requesting quotes is free. You pay vendors directly for their services.",
  },
  {
    q: "How do I list my business on Vela?",
    a: 'Go to "For vendors" from the home page, choose "I\'m a vendor" when creating your account, and fill in your business profile.',
  },
];

export default function HelpPage() {
  return (
    <main className="max-w-[760px] mx-auto px-6 py-10 w-full">
      <h1 className="text-[26px] font-semibold mb-2">Help centre</h1>
      <p className="text-ink-soft text-sm mb-6">
        Answers to the most common questions. Can&apos;t find yours? Email help@vela.example.
      </p>
      {FAQS.map((f) => (
        <div key={f.q} className="border-b border-line py-3.5">
          <div className="text-[14.5px] font-semibold mb-1.5">{f.q}</div>
          <div className="text-sm text-ink-soft leading-relaxed">{f.a}</div>
        </div>
      ))}
    </main>
  );
}
