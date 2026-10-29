# MONETIZATION_SPEC.md - How Vela earns money from vendors

Read with `EVENT_PLATFORM_MASTER_CONTEXT.md`. All prices below are **starting
assumptions to validate by talking to 10-15 Kerala vendors**. They live in the
database (`plans` table), never hard-coded, so they can change without code.

---

## 1. How LinkedIn earns (and what we copy)

LinkedIn keeps the basic profile free for everyone. It earns when someone pays
to **reach** or **be seen by** the other side: companies pay to find and hire
people, advertisers pay to reach members, and members pay for premium tools.

Our version: **customers use Vela free. Vendors pay to be found and to reach
customers.** The free vendor profile stays free so the site has supply.

## 2. Revenue streams (in build order)

| # | Stream | What the vendor pays for | Phase |
|---|---|---|---|
| 1 | **Lead unlock (credits)** | Customer inquiries arrive with contact details hidden. The vendor spends 1 credit to see the phone/WhatsApp. | 6 |
| 2 | **Subscription plans** | Monthly plan = more services, more photos, monthly credits, badge, analytics, better ranking. | 6 |
| 3 | **Featured placement** | Top spot for a district + category for N days. Always labeled "Featured". | 6 |
| 4 | **Booking commission** | A small % when a booking is paid through Vela (needs online booking + payments). | later |
| 5 | **Ads / sponsored** | Banner or sponsored vendor slots once traffic is high. | later |

Why leads first: it is the thing a vendor already understands ("pay for a real
customer enquiry"), it is cheap to try, and it scales with how useful Vela is.

## 3. Plans (suggested starting point)

| | **Starter** (free) | **Pro** | **Premium** |
|---|---|---|---|
| Price per month | INR 0 | INR 999 | INR 2,499 |
| Price per year | - | INR 9,990 (2 months free) | INR 24,990 |
| Services | 3 | 10 | unlimited |
| Portfolio photos | 10 | 50 | 200 |
| Lead unlocks per month (free grant) | 3 | 20 | 60 |
| Verified badge | no (after phone OTP: "Phone verified") | yes | yes |
| Public WhatsApp button on profile | no | yes | yes |
| Profile analytics (views, inquiries) | no | basic | full |
| Search ranking boost | none | small | medium |
| Featured placement | buy separately | buy separately | 1 free week per month |
| Support | email | email | priority |

Extra lead packs (any plan): 10 credits INR 499, 30 credits INR 1,299 (about
INR 43-50 per lead). Credits bought never expire; monthly grants expire at
period end.

**Break-even maths (illustrative, not a promise):** running cost is about
INR 4,500 per month (see master file section 9). Five Pro vendors at INR 999 is
about INR 5,000 per month before gateway fees and tax. Fifty Pro vendors is
about INR 50,000 per month.

## 4. Launch strategy (important)

1. **Founding Vendor offer.** First 3 months: billing OFF (`BILLING_ENABLED=false`).
   Every vendor gets Pro features free and a "Founding Vendor" badge plus a
   locked-in discount (for example 30 percent off Pro for 12 months). This
   builds supply and gives data on real lead volume.
2. **Turn billing ON** when there are enough real customers sending inquiries
   (suggested trigger: at least 100 inquiries per month across Kerala).
3. Only then show prices. Announce 30 days ahead by email/WhatsApp.
4. Review prices every quarter using the dashboard numbers (see section 9).

Do not hide the vendor's phone number before customers trust the site; do it
together with the unlock flow so the value is clear ("you only pay for real
enquiries").

## 5. Anti-bypass rules

Vendors will try to take customers off-platform. Reduce it without being rude:

- Customer contact goes through the inquiry form. The vendor's phone is not
  shown publicly on Starter plans.
- Customer phone is hidden from the vendor until unlock.
- Mask phone numbers typed in free-text fields (inquiry message, reviews)
  where simple (digits pattern) - best effort only.
- Reviews are only allowed from customers who sent an inquiry to that vendor
  (later: confirmed booking).
- If a customer reports "vendor never replied", the unlock credit is refunded
  once, automatically, if the vendor did not change the lead status within 7 days.

## 6. Database (migration `003_billing.sql`)

All money is stored as integer **paise** (INR x 100). Never floats.

```sql
plans(
  id, code UNIQUE,            -- 'starter' | 'pro' | 'premium'
  name, price_month_paise, price_year_paise,
  max_services, max_portfolio_items, monthly_lead_credits,
  features JSONB,             -- {"verified_badge":true,"public_whatsapp":true,"analytics":"basic","rank_boost":1}
  active BOOLEAN, sort_order
)

vendor_subscriptions(
  id, vendor_id -> vendors, plan_id -> plans,
  status,                     -- 'active' | 'past_due' | 'cancelled' | 'expired'
  billing_period,             -- 'month' | 'year'
  current_period_start, current_period_end,
  provider, provider_subscription_id, cancel_at_period_end BOOLEAN,
  created_at
)  -- one ACTIVE row per vendor (partial unique index). No row = Starter.

lead_credit_ledger(           -- append-only; balance = SUM(delta)
  id, vendor_id, delta INTEGER,
  reason,                     -- 'monthly_grant' | 'purchase' | 'unlock' | 'refund' | 'admin' | 'founding_bonus'
  quote_request_id NULL, payment_id NULL,
  expires_at NULL,            -- monthly grants expire; purchases do not
  created_at
)

lead_unlocks(                 -- vendor_id + quote_request_id UNIQUE (unlock is idempotent)
  id, vendor_id, quote_request_id, credit_ledger_id, unlocked_at
)

payments(
  id, vendor_id, purpose,     -- 'subscription' | 'credit_pack' | 'featured'
  amount_paise, currency DEFAULT 'INR',
  provider DEFAULT 'razorpay', provider_order_id UNIQUE, provider_payment_id,
  status,                     -- 'created' | 'paid' | 'failed' | 'refunded'
  metadata JSONB, created_at, paid_at
)

payment_webhook_events(       -- idempotency: provider_event_id UNIQUE
  id, provider_event_id, event_type, payload JSONB, processed_at
)

featured_placements(
  id, vendor_id, district_id, category_id,
  starts_at, ends_at, payment_id NULL, status,   -- 'active' | 'expired' | 'cancelled'
  created_at
)

vendors ADD founding_vendor BOOLEAN DEFAULT false, gstin TEXT NULL
quote_requests ADD source TEXT DEFAULT 'web'   -- for later analytics
```

Seed `plans` in the migration with the table in section 3.

## 7. Business rules (enforced on the server, never only in the UI)

- **Entitlement lookup:** one function `getVendorEntitlements(vendorId)` returns
  plan code, max services, max photos, credit balance, feature flags. If
  `BILLING_ENABLED=false`, return Pro entitlements for everyone.
- `createService` fails with 402-style error `{code:"PLAN_LIMIT", limit:"services"}`
  when the vendor is at `max_services`. Same for portfolio uploads.
- **Leads list API:** returns every lead, but `phone` and `message` are `null`
  and `locked: true` until a `lead_unlocks` row exists. Name is shown as first
  name + initial. Event date, budget, district and requested services are
  always visible (so the vendor can decide whether to pay).
- **Unlock:** `POST /api/leads/:id/unlock` runs in ONE transaction:
  lock vendor row, check not already unlocked, check balance >= 1, insert
  ledger -1, insert `lead_unlocks`. Returns the revealed contact. Two parallel
  requests must never charge twice (test this).
- **Monthly grant:** when a subscription period starts or renews, insert a
  `monthly_grant` ledger row (with `expires_at`). Starter vendors get their 3
  credits on the 1st of each month via a scheduled job (Vercel Cron) that is
  safe to run twice.
- **Credit usage order:** use credits that expire soonest first.
- **Refund rule:** see section 5. Implement as a daily cron.
- **Ranking:** search order = featured (active placement for that district+
  category) first, then `plan.features.rank_boost`, then rating/reviews. Featured
  vendors show a visible "Featured" label. No hidden paid ranking.
- **Downgrade:** never delete data. Services/photos above the new limit become
  read-only hidden ("inactive") until the vendor upgrades or removes some.

## 8. Payments with Razorpay (India, supports UPI/cards/netbanking)

1. Start in **test mode**. Keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `RAZORPAY_WEBHOOK_SECRET` in env (never in git). Live keys only after KYC and
   after the human approves.
2. Flow for credit packs / featured (one-time): server creates a Razorpay
   **order** with the amount from OUR database (never from the browser) and a
   `payments` row in `created` state -> client opens Razorpay Checkout ->
   client sends back `razorpay_payment_id`, `razorpay_order_id`,
   `razorpay_signature` -> server **verifies the signature** and marks paid.
3. The **webhook is the source of truth**: `POST /api/webhooks/razorpay`
   verifies the signature header, inserts into `payment_webhook_events`
   (ignore duplicates), then applies the effect (add credits, activate plan,
   activate featured placement) exactly once.
4. Subscriptions: use Razorpay Subscriptions (plans created per `plans.code` and
   period). Handle: activated, charged (renew + monthly grant), halted/failed
   (`past_due`, 7-day grace then back to Starter), cancelled.
5. Receipt email after each payment. Store `gstin` if the vendor gives one.
6. Admin can: see payments, manually grant/revoke credits, change a plan, refund
   (initially refund is done in the Razorpay dashboard and marked in our table).
7. Check current Razorpay fees before final pricing. Prices shown to vendors
   should state whether GST is included.

**Tax:** ask a Chartered Accountant about GST registration and invoicing before
turning billing ON. Do not guess. The agent only stores amounts, `gstin`, and
sends a receipt; proper tax invoices are a human/CA decision.

## 9. Vendor billing screens

- `/dashboard/billing`: current plan, renewal date, credit balance, buy credits,
  upgrade/downgrade, payment history, "Founding Vendor" badge info.
- Dashboard leads list: locked cards with "Unlock for 1 credit" button, balance
  shown, link to buy more.
- Pricing page `/pricing` (public) built from the `plans` table.
- Upgrade prompts only where a limit is hit ("You have 3 of 3 services").

## 10. Admin revenue dashboard (`/admin/revenue`)

Show: paying vendors by plan, monthly recurring revenue (MRR), credits sold,
unlock count, inquiries per month, % of inquiries unlocked, vendors who hit
limits, churn (cancelled this month). These numbers decide price changes.

## 11. Tests required

- Plan limits: 4th service on Starter rejected, allowed on Pro.
- Leads API masks phone until unlock; unlock reveals; unlock twice charges once.
- **Concurrency:** 5 parallel unlock requests with 1 credit -> exactly 1 success.
- Not enough credits -> clear error, nothing changes.
- Webhook: bad signature rejected; same event twice applies once; order amount
  mismatch rejected.
- `BILLING_ENABLED=false` gives Pro entitlements and never asks for payment.
- Featured vendors rank first only inside their district+category and only
  while active; expired placements stop ranking.
- Downgrade hides (does not delete) excess services.
- Use Razorpay **test mode** keys and fixture webhook payloads signed with the
  test secret; never call live Razorpay from tests.

## 12. Definition of done for Phase 6

All tests above pass in CI, billing works end to end in Razorpay test mode,
`BILLING_ENABLED` defaults to `false` in production until the human flips it,
and `docs`/master file/PROJECT_LOG are updated.
