// Offerings tree on the public profile (PRODUCT_PLAN 7 "Vendor profile"):
// units grouped by category with price, price unit and a "Bookable
// separately" badge; package-only units under "Included in our packages";
// packages listed with the units they include. Server component.

import type { ReactNode } from "react";
import type { OfferingView, ProfileOfferings } from "./profile-data";

function Badge({ tone, children }: { tone: "accent" | "muted"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-5 ${
        tone === "accent" ? "bg-accent-tint text-accent-hover" : "bg-surface-muted text-ink-soft"
      }`}
    >
      {children}
    </span>
  );
}

function Price({ o }: { o: OfferingView }) {
  return <div className="text-[15px] font-semibold text-accent sm:text-right">{o.priceText}</div>;
}

function UnitRow({ o, quote }: { o: OfferingView; quote?: (id: number) => ReactNode }) {
  return (
    <li className="p-4 sm:p-5" id={`offering-${o.id}`}>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h4 className="text-[15px] font-semibold">{o.title}</h4>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {o.separate ? <Badge tone="accent">Bookable separately</Badge> : <Badge tone="muted">Package only</Badge>}
            {o.guestRange ? <Badge tone="muted">{o.guestRange}</Badge> : null}
          </div>
        </div>
        <div className="shrink-0">
          <Price o={o} />
        </div>
      </div>
      {o.description ? <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">{o.description}</p> : null}
      {o.inclusions.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Includes">
          {o.inclusions.map((i) => (
            <li key={i} className="chip">
              {i}
            </li>
          ))}
        </ul>
      ) : null}
      {o.addons.length ? (
        <div className="mt-3 rounded-control bg-surface-muted px-3 py-2.5">
          <div className="eyebrow mb-1">Add-ons</div>
          <ul className="space-y-1 text-sm">
            {o.addons.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="min-w-0">{a.title}</span>
                <span className="shrink-0 text-ink-soft">{a.priceText}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {quote && o.separate ? <div className="-mb-1.5 mt-2">{quote(o.id)}</div> : null}
    </li>
  );
}

export default function OfferingsSection({
  data,
  fallbackPrice,
  quote,
}: {
  data: ProfileOfferings;
  fallbackPrice: string;
  /** Renders a "Request quote" trigger for an offering (omitted for the owner). */
  quote?: (id: number) => ReactNode;
}) {
  if (data.total === 0) {
    return (
      <ul className="overflow-hidden rounded-card border border-line">
        <li className="flex items-start justify-between gap-4 p-4 sm:p-5">
          <span className="text-sm text-ink-soft">Starting from</span>
          <span className="text-right text-sm font-semibold text-accent">{fallbackPrice}</span>
        </li>
      </ul>
    );
  }
  const multi = data.groups.length > 1 || data.packages.length > 0;
  return (
    <div className="space-y-6">
      {data.packages.length ? (
        <div>
          <h3 className="eyebrow mb-2">Packages</h3>
          <ul className="space-y-3">
            {data.packages.map((p) => (
              <li key={p.id} id={`offering-${p.id}`} className="rounded-card border border-line p-4 sm:p-5">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <h4 className="text-[15px] font-semibold">{p.title}</h4>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge tone="accent">Package</Badge>
                      {p.guestRange ? <Badge tone="muted">{p.guestRange}</Badge> : null}
                    </div>
                  </div>
                  <Price o={p} />
                </div>
                {p.description ? <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">{p.description}</p> : null}
                {p.items.length ? (
                  <div className="mt-3">
                    <div className="text-caption font-medium text-ink-soft">Includes</div>
                    <ul className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      {p.items.map((i) => (
                        <li key={i.id} className="flex items-start gap-2">
                          <svg className="mt-[3px] shrink-0 text-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          <span className="min-w-0">
                            {i.title}
                            {i.qty && i.qty !== "1" ? <span className="text-ink-soft"> × {i.qty}</span> : null}
                            {i.note ? <span className="text-ink-soft"> · {i.note}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {p.inclusions.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Also included">
                    {p.inclusions.map((i) => (
                      <li key={i} className="chip">
                        {i}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {quote ? <div className="-mb-1.5 mt-2">{quote(p.id)}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.groups.map((g) => (
        <div key={g.category}>
          {multi ? <h3 className="eyebrow mb-2">{g.category}</h3> : null}
          {g.units.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
              {g.units.map((u) => (
                <UnitRow key={u.id} o={u} quote={quote} />
              ))}
            </ul>
          ) : null}
          {g.packageOnly.length ? (
            <div className={g.units.length ? "mt-3" : ""}>
              <div className="mb-1.5 text-caption font-medium text-ink-soft">Included in our packages</div>
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-dashed border-line-strong">
                {g.packageOnly.map((u) => (
                  <UnitRow key={u.id} o={u} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
