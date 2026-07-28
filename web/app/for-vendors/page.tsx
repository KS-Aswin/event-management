import Link from "next/link";

const BENEFITS = [
  "A business profile with your portfolio, pricing, and availability calendar",
  "Direct quote requests from customers actively planning an event",
  "A dashboard showing leads, profile visitors, and conversion rate",
  "A verification badge that builds trust with new customers",
];

export default function ForVendorsPage() {
  return (
    <main className="max-w-[760px] mx-auto px-6 py-10 w-full">
      <h1 className="text-[26px] font-semibold mb-2">Grow your business with Vela</h1>
      <p className="text-ink-soft text-sm mb-6">
        Join the marketplace couples and event planners across Kerala are already searching.
      </p>
      <ul className="space-y-2 mb-6">
        {BENEFITS.map((b) => (
          <li key={b} className="text-[14.5px] pl-6 relative">
            <span className="absolute left-0 text-accent font-semibold">✓</span>
            {b}
          </li>
        ))}
      </ul>
      <Link
        href="/signup?role=vendor"
        className="inline-block px-5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
      >
        Create vendor account
      </Link>
    </main>
  );
}
