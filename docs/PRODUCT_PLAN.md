# Vela Product Plan

Status: **decided, ready to build**. Written Oct 2026 by the product owner (synthesis of six persona analyses: event company, creative vendor, operations vendor, wedding customer, small-event customer, admin).
Grounded in: `web/db/migrations/001–003`, `docs/MONETIZATION_SPEC.md`, and the current `web/app` routes.
Where this plan and an older doc disagree, this plan wins. Section 9 lists the open decisions. Each one has a default, so building does not have to wait.

---

## 1. Summary and principles

Vela is a Kerala-first marketplace where customers find, compare and enquire with event vendors: photographers, caterers, chenda melam troupes, venues, full-service event companies and the rest. The code today is a working MVP. It has search, a vendor profile, a single shared `/dashboard`, quotes that only carry a status, and reviews. It is missing the things that make it a real product:

- **Vendors cannot upload a single image.** No upload route, no storage library, and `portfolio_items` has no writer.
- **The offering model is too thin.** It has a title, one price and one unit. An event company cannot list photography, decor and catering as separate units, and a caterer cannot say "₹280/plate, minimum 150".
- **Roles share one dashboard.** After login everyone gets the same page or the customer home. Admins have no area at all.
- **Every listing goes live without review**, because `vendors.status` defaults to `'approved'`.

### Principles

1. **Kerala-first, not Kerala-only.**
   - Districts, communities and event types all come from data: Hindu, Christian and Muslim weddings, choroonu, noolukettu, griha pravesham, baptism, Onam corporate events.
   - Prices are in ₹ using the Indian digit grouping (₹2,50,000).
   - The UI is WhatsApp-first and assumes a phone on 4G.
   - Every Kerala-specific list (districts, event types, offerings) is a database table, so adding Tamil Nadu later is a data change.
2. **Role-separated.** There are three logged-in experiences, and each has its own URL prefix, header and landing page:
   - Customer: `/my`
   - Vendor: `/vendor`
   - Admin: `/admin`
   A vendor never lands on the customer home after login, and an admin never sees vendor or customer tools.
3. **Real vendor diversity.** A solo mehendi artist, a 15-person event company, a pandal-rental shop and a priest all list on one platform. The model handles this with:
   - **offering templates per category**, carrying category-specific attributes as validated JSONB;
   - **many pricing units**;
   - a **bookable separately / package only** flag per offering;
   - **packages built from offerings**;
   - an **"Other (custom)"** escape hatch that admins can promote into the taxonomy.
4. **"Code side perfect first."** We finish and test the product in code, on local Postgres and local disk storage, before spending money or opening external accounts. Every external dependency sits behind an interface and an env flag and defaults off or local:
   - storage
   - payments
   - email
   - WhatsApp
   - OTP

   This follows the owner's free-tools-only-until-income rule.
5. **The server enforces every rule.** Plan limits, package-only rules, role guards and moderation states are checked in API handlers and, where cheap, in DB constraints. The UI only reflects them.
6. **Never destroy vendor data.** When something goes over a limit, is downgraded or is moderated, it gets *hidden* with a reason, never deleted. Reviews are hidden, never hard-deleted.
7. **Billing stays dormant but designed in.** Entitlements are checked through `getVendorEntitlements()` from day one. While `BILLING_ENABLED=false` it returns Pro limits for everyone, plus the Founding Vendor badge.

---

## 2. Role map

### 2.1 Why `/vendor` (and not `/dashboard`) for the vendor workspace

**Decision: the vendor workspace lives at `/vendor/...`, the customer area at `/my/...`, and the admin area at `/admin/...`. `/dashboard` is retired and becomes a role-aware redirect.**

Reasons:

- `/dashboard` is ambiguous. Today `app/dashboard/page.tsx` branches on `isVendor` and loads customer favourites and quotes for vendors too, which is the root of the mixed-role bugs.
- A distinct prefix per role lets one guard work for the whole area: `web/proxy.ts` (Next 16 renamed middleware to proxy) plus a `layout.tsx` guard in each route group. "Customer on vendor page" becomes impossible by construction.
- The URLs read well to a vendor ("vela.in/vendor/leads") and match `/my` and `/admin`.
- Existing bookmarks and e-mails keep working through the `/dashboard/*` redirects (2.6).

### 2.2 Public pages

| Route | Role | Purpose | Status |
|---|---|---|---|
| `/` | all | Home: hero search (what / where / when), event-type chips, category chips, featured districts | change (add event-type chips, real media on cards) |
| `/search` | all | Results. Filters: category, offering, district (served), budget per unit, date, event type, rating, verified. Toggle between vendor cards and offering cards. | change |
| `/vendors/[id]` | all | Public profile: cover, logo, badges, offerings and packages, gallery (albums, videos), service areas, reviews with replies, enquiry CTA, WhatsApp | change |
| `/e/[slug]` | all | Event-type landing (`/e/nikah`, `/e/hindu-wedding`, `/e/birthday`): "what you need" category bundle and top vendors | new (P2) |
| `/c/[slug]` | all | Category landing, also for SEO (`/c/photography?district=thrissur`) | new (P2) |
| `/for-vendors` | public, customer | Vendor pitch. Leads to `/signup?role=vendor` | exists (hidden in nav for customers, footer link) |
| `/pricing` | all | Plans from the `plans` table. Hidden (404) while `BILLING_ENABLED=false` | new (P3) |
| `/enquiry/[token]` | guest | Track a guest enquiry: status, vendor replies, offer accept or decline | new (P2) |
| `/about`, `/help`, `/privacy` | all | Static | exists |
| `/terms` | all | Terms, content policy (no communal or caste remarks), media consent | new (P1) |
| `/login`, `/signup` | logged-out | Auth. Signup asks for the role. Vendor signup continues to `/vendor/onboarding`. | change |

### 2.3 Customer area (`role = customer`)

| Route | Purpose | Status |
|---|---|---|
| `/my` | Customer home: upcoming event card, recent vendor replies, shortlist preview, "what you still need" for the event type | new (P2) |
| `/my/enquiries` | All enquiries grouped by event date: status, vendor, units asked, latest offer | new (P2), replaces the customer half of `/dashboard` |
| `/my/enquiries/[id]` | Thread: messages, offer versions with line items, accept / decline / withdraw | new (P2) |
| `/my/shortlist` | Favourites grouped by category, with notes, "Send one enquiry to selected (max 5)" and compare | new (P2), replaces favourites in `/dashboard` |
| `/my/compare?ids=` | Side-by-side for 2–4 vendors | new (P2) |
| `/my/reviews` | Reviews written, plus pending "rate your vendor" prompts | new (P2) |
| `/settings` | Account: name, phone (E.164), WhatsApp opt-in, notifications, password, delete account | exists (shared by all roles, content varies by role) |

### 2.4 Vendor workspace (`role = vendor`)

| Route | Purpose | Status |
|---|---|---|
| `/vendor` | Workspace home: listing status banner, profile-strength checklist, new leads, today and upcoming booked dates, 7-day stats, quick actions | new (P0) |
| `/vendor/onboarding` | Step wizard by vendor type and category (`?step=1..6`); a draft is saved at every step | new (P0), replaces `/dashboard/create-listing` |
| `/vendor/profile` | Business details: name, type, legal name, GSTIN/FSSAI, about, year started, team size, languages, contact, socials, address/landmark | new (P0), replaces `/dashboard/edit-listing` |
| `/vendor/areas` | Home district, served districts with travel fee or note, travel outside Kerala | new (P0) |
| `/vendor/offerings` | Units, packages and add-ons list. Tabs: Offerings / Packages / Add-ons. Reorder, activate, see plan usage. | new (P0), replaces `/dashboard/services` |
| `/vendor/offerings/new?template=` and `/vendor/offerings/[id]` | Offering editor: template or Other, attributes form (from schema), price mode/unit/min qty, sale mode, fulfilment, event types, cover, media | new (P0) |
| `/vendor/packages/new` and `/vendor/packages/[id]` | Package composer: pick units, qty, inclusions, guest range, price | new (P0) |
| `/vendor/media` | Media library: albums, upload images and MP4, add YouTube/Instagram links, set logo and cover, reorder, captions, consent, moderation status | new (P0) |
| `/vendor/media/albums/[id]` | Album editor | new (P0) |
| `/vendor/leads` | Leads inbox with filters (status, date, district, unit), notes, follow-up date | new (P0 basic, P2 full), replaces `/dashboard/leads` |
| `/vendor/leads/[id]` | Lead detail: full enquiry context, selected units, thread, send offer, mark booked or declined | new (P0 read + status, P2 offers/thread) |
| `/vendor/calendar` | Month view: block dates or slots, capacity, booked days from leads | new (P2) |
| `/vendor/reviews` | Reviews list, public reply, "request a review" link | new (P2) |
| `/vendor/documents` | Upload GSTIN / trade licence / FSSAI / PAN, see verification status | new (P1) |
| `/vendor/insights` | Profile views, WhatsApp clicks, enquiries, booked conversion | new (P2 basic) |
| `/vendor/billing` | Plan, credits, payments, Founding Vendor info | new (P3; hidden while billing is off) |
| `/vendor/preview` | Redirects to `/vendors/[id]?preview=1`, which shows owners a non-approved profile with a "Preview, not public yet" ribbon | new (P0) |

### 2.5 Admin area (`role = admin`)

| Route | Purpose | Status |
|---|---|---|
| `/admin` | "Today" inbox: queue counts plus the oldest item per queue (pending vendors, reports, media to check, custom offerings, documents, complaints) | new (P1) |
| `/admin/vendors` | Vendor queue and list, filtered by status, district, category, created date, with duplicate hints | new (P1) |
| `/admin/vendors/[id]` | Full vendor review: profile, offerings, media, documents, status history, audit. Actions: approve / request changes / reject / suspend / verify badge / edit / assign owner | new (P1) |
| `/admin/reviews` | Review reports queue: hide / unhide / dismiss | new (P1) |
| `/admin/media` | Media queue: pre-moderation for pending vendors, spot-check for recent uploads, reported media | new (P1) |
| `/admin/taxonomy` | Categories, offering templates (with attribute schema), event types and event-type bundles, all CRUD | new (P1) |
| `/admin/taxonomy/custom` | Custom "Other" offering queue grouped by normalised name: promote / merge / keep private / reject | new (P1) |
| `/admin/users` and `/admin/users/[id]` | Search users, view role and activity, suspend, force logout | new (P1) |
| `/admin/enquiries` | Enquiry monitor: volume, spam signals (same phone sending to many vendors), block a contact | new (P1) |
| `/admin/analytics` | Signups, listings by status, enquiries by district × category × event type, response rate, supply gaps | new (P1) |
| `/admin/audit` | Append-only audit log viewer | new (P1) |
| `/admin/revenue`, `/admin/plans`, `/admin/featured` | Per MONETIZATION_SPEC §10 | new (P3) |

### 2.6 Redirect and guard rules

Two layers implement these rules:

- **`web/proxy.ts`** does an optimistic check that reads only the session cookie role, for fast redirects.
- **`layout.tsx` server guards** in `app/my`, `app/vendor` and `app/admin` call `requireRole()`, which uses `getLiveSession()` and therefore reloads the user from the DB, checking role, `status` and `session_version`.

API handlers under `/api/vendor/*`, `/api/my/*` and `/api/admin/*` call the same helper. The proxy alone is never trusted.

| Situation | Result |
|---|---|
| Login or signup succeeds, role `customer` | `next` if present and allowed for customers, else `/my` |
| Login succeeds, role `vendor`, no listing or `onboarding_completed_at IS NULL` | `/vendor/onboarding?step=<saved step>` |
| Login succeeds, role `vendor`, onboarding done | `/vendor` (`next` honoured only if it starts with `/vendor` or is a public page) |
| Login succeeds, role `admin` | `/admin` (`next` honoured only if it starts with `/admin`) |
| Anonymous hits `/my/*`, `/vendor/*` | `/login?next=<path>` |
| Anonymous or non-admin hits `/admin/*` | **404** (do not reveal it exists). `/api/admin/*` returns 404 too. |
| Customer hits `/vendor/*` | `/my` |
| Vendor hits `/my` or `/my/shortlist` | `/vendor`. Exception: `/my/enquiries[/id]` is allowed, so a vendor can see enquiries *they* sent as a customer. |
| Admin hits `/my/*` or `/vendor/*` | `/admin` |
| `/dashboard` | customer → `/my`, vendor → `/vendor`, admin → `/admin` |
| `/dashboard/create-listing` | `/vendor/onboarding` |
| `/dashboard/edit-listing` | `/vendor/profile` |
| `/dashboard/services` | `/vendor/offerings` |
| `/dashboard/leads` | `/vendor/leads` |
| Suspended user with a live cookie | Cookie destroyed on the next request and the user is sent to `/login?suspended=1` |
| Vendor visiting `/` or any public page | Allowed (they want to see how they appear). The header stays the vendor header. |

### 2.7 Header and navigation per role

- **Public (logged-out):**
  - Logo → `/`
  - Search field (compact on mobile)
  - "Browse" (categories and event types)
  - "For vendors"
  - "Log in"
  - "Sign up" (primary)
- **Customer:**
  - Logo → `/`
  - Search
  - "My events" → `/my`
  - "Enquiries" (with an unread dot)
  - "Shortlist" (with a count)
  - Avatar menu: Settings, Help, Log out

  "For vendors" moves to the footer only. On mobile the main links collapse into the avatar sheet.
- **Vendor:** a distinct workspace header with a "Workspace" pill next to the logo.
  - Logo → `/vendor`
  - Nav: Home, Leads (badge = new), Offerings, Media, Calendar, Profile
  - Right side: "View my listing" (public profile, preview if pending), status chip (Draft / Under review / Live / Changes requested / Suspended), avatar menu (Business profile, Service areas, Documents, Reviews, Insights, Billing (hidden while billing is off), Account settings, Help, Log out)
  - **Mobile:** a fixed bottom tab bar (Home, Leads, Offerings, Media, More)
  - During onboarding the header collapses to logo, step progress and "Save & exit".
- **Admin:**
  - Logo plus a red "Admin" pill → `/admin`
  - Nav: Today, Vendors, Reviews, Media, Taxonomy, Users, Enquiries, Analytics, Audit
  - Avatar menu: Settings, Log out
  - Every admin page sends `<meta name="robots" content="noindex">` and `Cache-Control: no-store`.

The header component takes `role` from the server session. There is one `SiteHeader` that switches between four nav configs. Role links are never hidden with client-only checks.

---

## 3. Offering taxonomy

### 3.1 Model in one paragraph

**Category** (top level, e.g. Photography) has many **offering templates** (standard units such as "Candid wedding photography" or "Drone coverage"). Each template has a code, a default and allowed price units, and an **attribute schema** (JSON field definitions). A vendor creates **offerings**: rows in `services`, which keeps its table name to avoid churn, shown as "Offerings" in the UI.

Each offering does one of two things:

- points to a template (standard), or
- carries a custom name ("Other"), which also files a **custom offering request** for admin review.

Every offering has a `category_id`. This is what lets an event company's photography unit appear in Photography search.

An offering's `kind` is one of:

- `unit` (a sellable thing),
- `package` (a bundle built from units through `package_items`),
- `addon` (an extra that attaches to a parent offering, such as Drone attached to Wedding photography).

### 3.2 Pricing

- `price_mode`:
  - `from` (default): "Starting from ₹X"
  - `fixed`: "₹X"
  - `range`: "₹X – ₹Y"
  - `on_request`: "Price on request"
- `on_request` is allowed only when the template or category has `allow_on_request=true`, which covers:
  - packages,
  - Event Management,
  - Priest & Rituals,
  - custom décor,
  - Venue (full-day enquiries).
- Search's budget filter excludes on-request offerings unless the "include price on request" box is ticked.
- `price_unit` (CHECK list): `event, package, day, hour, slot, plate, person, artist, item, set, kg, sqft, km, vehicle, session`.
- Display labels come from the unit plus an optional `unit_label` override, e.g. `plate` shown as "per leaf" for sadhya.
- `min_qty` / `max_qty` / `qty_step` are NUMERIC, so 0.5 kg cakes work. Examples: minimum 100 plates, minimum 1 kg in 0.5 steps, maximum 3,000 guests.
- Catalogue prices stay **integer rupees**, as today. Money in quotes and offers is stored in **paise** (integers), matching the billing spec.
- `vendors.price` and `price_label` become a **derived cache**: the cheapest active, priced, publicly sellable offering. It is recomputed in `lib` on every offering write and used for legacy sorting.

### 3.3 How a full event-management vendor lists units

1. **Onboarding step 2.** The vendor picks primary category "Event Management". The wizard shows the **EM checklist**:
   - the EM-native templates (planning, coordination, theme design, hospitality, logistics);
   - the **core templates of other categories**, grouped by category: Decoration → Stage / mandapam décor; Photography → Wedding photography; Catering → Sadhya; and so on;
   - "Other (custom)".
2. **Each ticked unit becomes an offering** with that unit's own `category_id` (Photography, not Event Management). It has:
   - **Sale mode**:
     - **"Bookable separately"** (default): appears in category search as an offering card ("Wedding photography · by Thrissur Events"), can be ticked alone in the enquiry form, and can be quoted alone.
     - **"Package only"**: visible on the profile inside packages and under "Included in our packages", but never shown as its own search card and never enquirable alone. The quote API rejects an enquiry whose selected offerings are all `package_only` (`400 PACKAGE_ONLY`), and drops a package-only unit selected without one of its parent packages.
   - **Fulfilment**: In-house / Partner (shown on the profile as "via partner").
   - Price, unit, min qty, attributes, optional cover image and photos.
3. **Packages.** In `/vendor/packages/new` the vendor names the package ("Hindu wedding basic") and adds units with qty and notes (300 × sadhya plates, 1 × mandapam décor, 1 × wedding photography). The vendor then sets:
   - the package price (price mode `from`/`fixed`/`range`/`on_request`, usually unit `package` or `event`),
   - a guest range,
   - event types,
   - free-text inclusions.

   A package is an offering with `kind='package'` and its own `category_id`, which defaults to the vendor's primary category. It can be enquired, so `quote_request_services` keeps working for packages.
4. **Integrity rules:**
   - A package's items must belong to the same vendor (DB trigger).
   - Deactivating a unit used in a package marks that package `incomplete=true` (shown to the vendor, hidden from search) instead of silently changing it.
   - A package can be `kind='package'` only with `sale_mode='separate'`.
   - Add-ons need `parent_service_id` and are enquirable only together with their parent.
   - A vendor can't sell a unit separately in a district they don't serve, though search still shows them with "travel on request" (see 3.6).

A solo vendor (photographer, priest) sees the same model without the checklist. They pick 1–3 categories and add offerings from those categories' templates.

### 3.4 Category catalogue (seeded in migration 004)

Notation: **templates** = standard offerings; *attrs* = key attribute schema fields; **units** = allowed price units (default first). Every category also allows **Other (custom)**.

| # | Category (slug) | Standard offerings (templates) | Key attributes | Price units |
|---|---|---|---|---|
| 1 | Event Management (`event-management`) | Full planning & coordination; Day-of coordination; Theme & concept design; Guest hospitality & welcome (thalappoli team); Logistics (guest transport, valet); Vendor sourcing; Corporate event production. **Plus the checklist of other categories' core units.** | event_types[], max_guests, max_events_per_day, crew_size, in_house_units[] | package, event, day; on_request allowed |
| 2 | Venue (`venue`) | Auditorium / convention hall; Banquet hall (AC); Outdoor lawn; Beach / backwater venue; Temple / church parish hall; Resort / homestay | seating_capacity, floating_capacity, dining_capacity, dining_batches, ac, parking_cars, parking_bikes, rooms, generator, outside_caterer_allowed, outside_decor_allowed, alcohol_allowed, stage_included | slot (morning/evening), day, event; on_request allowed. Uses slots. |
| 3 | Photography (`photography`) | Wedding photography (traditional); Candid photography; Pre-wedding / save-the-date shoot; Engagement shoot; Baptism / choroonu / birthday shoot; Drone coverage (addon); Album printing (addon); Corporate / event photography | coverage_hours, photographers, edited_photos, album_sheets, album_type, delivery_days, drone, raw_files, same_day_edit, women_led | event, day, hour, session, item (album) |
| 4 | Videography (`videography`) | Wedding cinematic film; Traditional full video; Highlights / teaser reel; Live streaming; Drone video (addon); LED wall at venue (addon) | videographers, film_minutes, highlight_minutes, delivery_days, drone, live_stream, cameras | event, day, hour |
| 5 | Catering (`catering`) | Kerala sadhya (veg, banana leaf); Malabar biryani; Christian wedding menu (appam, stew, roasts); Nikah / Mandi menu; North Indian buffet; Snacks & tea; Live counters; Serving staff (addon); Tasting session (addon) | food_pref (veg / non_veg / both), cuisines[], item_count, serves_at (hall / home / parish hall), max_guests_per_day, kitchen_crews, fssai_no | plate (label "per leaf" for sadhya), person, event, item; min_qty required |
| 6 | Decoration & Florist (`decoration`) | Stage / mandapam décor; Nikah stage; Church aisle décor; Entry / theme arch; Flower decoration (fresh); Car décor; Pookalam (flower carpet); Balloon / birthday theme; Haldi / mylanchi setup; LED backdrop (addon) | flower_type (fresh / artificial / mixed), theme_styles[], includes_lighting, setup_hours | event, item, sqft; on_request allowed |
| 7 | DJ & Music (`dj-music`) | DJ; Live band; Solo singer / ghazal; Instrumental (keyboard, violin, sax); Karaoke setup; Extra hour (addon) | hours, artists, genres[], equipment_included, languages[] | event, hour, artist |
| 8 | Traditional & Live Arts (`traditional-music`), **new** | Chenda melam (Shinkari / Pandi / Panchari); Panchavadyam; Nadaswaram / thavil; Thayambaka; Thiruvathira kali; Oppana; Margamkali; Kolkali; Kathakali / Mohiniyattam performance; Duff muttu | team_size, duration_min, costume_included, repertoire[], temple_festival_experience | event, artist, session |
| 9 | Sound & Lighting (`sound-lighting`) | PA / line-array sound; Stage lighting (LED par, moving heads); Truss & stage structure; LED wall; Generator backup; Special effects (cold pyro, fog) | wattage, speakers, lights_count, truss_size, led_wall_sqft, generator_kva, technicians | event, day, sqft (LED wall), item |
| 10 | Makeup (`makeup`) | Bridal makeup (HD); Airbrush bridal makeup; Groom makeup; Family / guest makeup; Hairstyling; Saree draping; Trial session (addon) | products[], airbrush, hairstyling, draping, travels_to_venue, studio_available, women_only_team | event, person, session |
| 11 | Mehendi (`mehendi`) | Bridal mehendi (hands + feet); Mylanchi night package; Guest mehendi; Arabic / Indo-Arabic designs | style[], organic_henna, coverage (hands / hands_feet), artists | event, person, item (per hand) |
| 12 | Rental (`rental`) | Pandal / shamiana; Chairs; Tables; Crockery & cutlery; Tower AC / air cooler; Generator; Stage platform; Furniture & lounge; Tents | qty_owned, material, delivery_included, damage_deposit, min_order_value | item (per day), sqft, day, set; uses inventory (P3 per date) |
| 13 | Cakes & Desserts (`cake`), **new** | Wedding / tiered cake; Birthday / theme cake; Cupcakes & desserts; Dessert table | flavours[], eggless, tiers, lead_time_days, delivery_radius_km, fssai_no | kg (step 0.5), piece, item |
| 14 | Invitations & Printing (`invitations`), **new** | Printed wedding cards; Box / premium invites; Digital e-invite; Video invite; Name boards / flex printing | card_type, languages[] (ml / en / ar), proof_days, min_quantity, design_fee | piece (min_qty 100), item, set |
| 15 | Transport (`transport`), **new** | Bridal car (decorated); Guest car (Innova / sedan); Tempo traveller; Bus (49-seat); Valet service | vehicle_type, seats, units_owned, km_included, hours_included, extra_km_rate, driver_bata, ac | vehicle (per 8 h / 80 km), day, km, event |
| 16 | Priest & Rituals (`priest`), **new** | Wedding ceremony (Hindu); Griha pravesham; Choroonu; Noolukettu; Ganapathi homam; Muhurtham consultation (addon); Pooja samagri (addon) | ceremonies[], tradition, brings_samagri, languages[], travel_area | event, session; on_request allowed (dakshina, "as you wish") |
| 17 | Event Host / Anchor (`event-host`) | Wedding anchor / MC; Corporate emcee; Kids entertainer / magician; Games host | languages[], hours, bilingual | event, hour |
| 18 | Gifts & Favours (`return-gifts`), **new** | Return gifts; Wedding favours; Corporate gift hampers | min_quantity, customisation, lead_time_days | piece, set |
| 19 | Entertainment (`entertainment`), **new** | Dance troupe; Maveli (Onam) / costume characters; Mimicry / stand-up; Fireworks (licensed); Photo booth / 360 booth | team_size, duration_min, licensed | event, hour, artist |

Notes:

- **"Wedding planner" (individual coordinator)** is Event Management → "Full planning & coordination" or "Day-of coordination", usually `package` with `on_request` or `from ₹50,000`. Their units are flagged `fulfilment='partner'`.
- **Existing category names are kept** (Decoration's display name becomes "Decoration & Florist"; the slug is `decoration`). This keeps `vendors.category` text matching working during the transition.
- **Event types** are seeded with a "what you need" bundle (`event_type_categories`, `is_core`). The types are: Hindu wedding, Christian wedding, Nikah, Engagement / Manasammatham, Reception, Mylanchi / Mehendi night, Baptism, First Holy Communion, Choroonu, Noolukettu, Griha pravesham, Birthday, Onam / Corporate, College fest, Other.

### 3.5 "Other / custom" handling

1. In any category, the vendor picks "Other" and types a name, e.g. "Kolkali team". The offering is created at once with `template_id=NULL` and `custom_name` set (`title` = custom name), using the category's base attribute set plus a free `unit_label`.
2. A `custom_offering_requests` row is created with `normalised_name`: lower-cased, with punctuation and spaces collapsed and common suffixes like "team" or "service" stripped.
3. **Visibility before promotion:** the offering shows on the vendor's profile and in free-text search (`q`). It is **not** a filter chip.
4. Contact details typed into custom names or descriptions (phone or URL regex) are masked and the request is flagged, since spec §5 calls for anti-bypass.
5. **Admin actions** in `/admin/taxonomy/custom`, where requests are grouped by normalised name with a vendor count:
   - **Promote:** creates a template in the chosen category and re-points every matching offering to it (`template_id` set, `custom_name` kept as the vendor's label), in one transaction.
   - **Merge:** maps the requests to an existing template.
   - **Keep private:** stays custom and is not promoted.
   - **Reject:** for an inappropriate entry. The offering is hidden and the vendor is told why.
6. Promotion is suggested once 3 or more vendors use the same normalised name.

### 3.6 Service areas and travel

- `vendor_service_areas(district_id, travel_fee, travel_note)`: free if the fee is NULL and the note is empty, "₹5,000 travel" if a fee is set, and "travel on request" if only the note is set.
- The home district is always served.
- Search's district filter matches the home district **or** any served district. Results outside both are omitted unless "show vendors who travel" is ticked. A `travel_outside_kerala` flag adds the "Travels across India" note.

---

## 4. Media design

### 4.1 What vendors can add

| Media | Where used | Notes |
|---|---|---|
| **Logo** | Profile header, offering cards, leads (to customers) | Square crop, min 200×200; doesn't count toward limits |
| **Cover** | Profile hero, search card | 16:9 crop, min 1200×675; doesn't count toward limits |
| **Images** | Gallery, albums, offering covers | Counted against `max_portfolio_items` |
| **Video links** | Gallery "Videos" tab, offering detail | YouTube (watch / shorts / youtu.be), Instagram (reel / p), Vimeo |
| **Video files (small MP4)** | Gallery "Videos" tab | Short showreels; off by default in production until object storage is configured |
| **Albums** | Gallery grouping ("Anu & Rahul · St. Mary's, Kottayam") | Title, event type, district, venue, date, cover, order, linked offering |
| **Documents** | Admin-only (private) | GST / trade licence / FSSAI / PAN; never public, never served by `/media` |

### 4.2 Limits (from `plans`, through `getVendorEntitlements()`)

| | Starter (free) | Pro | Premium | Billing OFF (everyone) |
|---|---|---|---|---|
| Portfolio images | 10 | 50 | 200 | 50 (Pro) |
| Albums | 2 | 10 | unlimited | 10 |
| Video links | 2 | 10 | 30 | 10 |
| MP4 uploads | 0 | 3 | 10 | 3 |

These go into `plans.max_portfolio_items` plus new columns `max_albums`, `max_video_links`, `max_video_files`. The spec's photo numbers are kept as they are.

**Per-file limits (all plans):**

- **Images**
  - Accepted: JPEG, PNG, WebP, **checked by magic bytes**.
  - Maximum 15 MB input. Minimum short side 500 px.
  - HEIC is rejected with the message "Please upload JPEG. On iPhone choose Most Compatible." The `<input accept="image/jpeg,image/png,image/webp">` makes iOS Safari transcode HEIC to JPEG automatically, and prebuilt sharp can't decode HEIC.
  - RAW (.CR3 / .NEF) is rejected with a clear message.
- **Client-side pre-resize:**
  - The browser downscales to a 2560 px long edge at JPEG q0.85 before upload (canvas). This saves 4G bandwidth in Idukki or Wayanad and keeps requests under the 4.5 MB serverless body limit on Vercel.
- **MP4**
  - `video/mp4` (`ftyp` box check), maximum 50 MB, maximum 90 s.
  - Duration is read client-side from `<video>` metadata and checked again server-side only by size.
  - No transcoding.
  - Poster: the client captures a frame to JPEG and uploads it as the poster image; otherwise a branded placeholder is shown.
- **Uploads go one file at a time** with progress and a retry button. A failed file doesn't block the others.

**Over limit:**

- An upload beyond the limit returns `402 {code:"PLAN_LIMIT", limit:"images"}`.
- After a downgrade, the excess (oldest, non-featured first) gets `status='hidden'` with `hidden_reason='plan_limit'`. Nothing is deleted.

### 4.3 Processing

Processing uses **`sharp`**, which is acceptable: MIT-licensed, free, with prebuilt binaries for win32-x64, linux-x64 and Vercel. It is added as a dependency in P0-5.

- Auto-rotate from EXIF, then **strip all metadata** (EXIF/GPS: protects home bakers' locations).
- Variants, all WebP q80:
  - `thumb` 320 px wide
  - `card` 800 px
  - `full` 1920 px long edge
- The original is not kept, which saves storage. Logo variants: 96, 256. Cover: card 800, full 1920.
- Store `width`, `height`, `bytes`, `sha256` (of the decoded original) and a dominant `placeholder_color` (sharp `stats()`) for blur-up.
- **Dedupe:** the same `sha256` for the same vendor returns the existing asset (`200 {duplicate:true}`).
- **Fallback if sharp fails to load** (an unsupported platform): store the client-resized JPEG as the single `full` variant, set `variants={}`, log a warning. The UI falls back to `full` for all sizes. This keeps dev working everywhere.
- Video files: no server processing. Size and type checks only.

### 4.4 Storage adapter

```ts
// web/lib/storage/types.ts
export interface StoredObject { key: string; contentType: string; bytes: number }
export interface StorageAdapter {
  readonly driver: "local" | "s3" | "r2" | "supabase";
  put(key: string, body: Buffer | Uint8Array, opts: { contentType: string; cacheControl?: string }): Promise<StoredObject>;
  get(key: string): Promise<{ body: ReadableStream | Buffer; contentType: string; bytes: number } | null>;
  delete(key: string): Promise<void>;          // idempotent
  publicUrl(key: string): string;              // URL the browser can load
  // optional: direct-to-bucket uploads (S3/R2/Supabase). Local returns an /api URL.
  createUploadUrl?(key: string, contentType: string, maxBytes: number): Promise<{ url: string; method: "PUT"; headers?: Record<string,string> }>;
}
// web/lib/storage/index.ts
export function getStorage(driver = process.env.STORAGE_DRIVER ?? "local"): StorageAdapter
```

- **`LocalDiskAdapter`** (dev and default):
  - Writes under `web/uploads/` (`STORAGE_LOCAL_ROOT`, gitignored), **not** `public/`, because Next does not serve files added to `public/` at runtime in production builds.
  - Serves files through `app/media/[...key]/route.ts`, which streams the file with:
    - the correct `Content-Type`,
    - `Cache-Control: public, max-age=31536000, immutable` (keys are content-unique),
    - **HTTP Range support** (needed for MP4 seeking),
    - path-traversal protection (normalise and reject `..`),
    - refusal of the `private/` prefix.
  - `publicUrl(key)` = `/media/<key>`.
- **Later adapters** behind the same interface, chosen by `STORAGE_DRIVER`:
  - `S3Adapter`: R2 and AWS, using `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_PUBLIC_BASE_URL`.
  - `SupabaseStorageAdapter`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`.

  These are built in P3 but **required before the first production deploy**, because the Vercel filesystem is ephemeral.
- **Every `media_assets` row stores `storage_driver`.** URLs are resolved through `getStorage(row.storage_driver).publicUrl(key)`, so assets keep working after a driver switch.
- **Keys:**
  - `vendors/{vendorId}/{assetUuid}/{variant}.webp`
  - `vendors/{vendorId}/{assetUuid}/video.mp4`
  - `private/vendors/{vendorId}/docs/{uuid}.{ext}` (documents; admin-only route)

**Upload flow.** It uses two steps so local and bucket storage share one client:

1. `POST /api/vendor/media/uploads {kind, filename, contentType, bytes, albumId?, serviceId?, purpose: 'gallery'|'logo'|'cover'|'poster'}`
   - The server checks entitlements and limits and creates a `media_assets` row with `status='uploading'`.
   - It returns `{assetId, uploadUrl, method:'PUT'}`. For the local driver `uploadUrl` = `/api/vendor/media/uploads/{id}/file`; for S3 it is a presigned PUT.
2. The client PUTs the bytes.
3. `POST /api/vendor/media/uploads/{id}/complete`
   - The server reads the object, checks magic bytes and size, runs sharp, writes the variants, deletes the raw upload key, and sets the status (4.5).
   - It returns the asset with its URLs.
4. A janitor (`npm run media:cleanup`, later a cron job) deletes rows stuck in `uploading` for more than 24 h, along with their objects.

### 4.5 Moderation states

`media_assets.status`:

- `uploading`: transient.
- `processing`: transient.
- `pending_review`: the vendor is not yet approved (pre-moderation together with the listing), **or** the asset was reported.
- `approved`: public.
- `rejected`: has a reason; visible to the vendor only.
- `hidden`: over plan limit, or the vendor unpublished it; carries a reason.

Deleted assets are removed rows: a vendor delete removes the row and the objects.

Rules:

- **Vendor not yet approved:** new media is `pending_review`. Approving the vendor in admin also approves all of its pending media in the same transaction (individual items can be rejected first).
- **Vendor already approved:** new media is `approved` immediately (post-moderation) and appears in `/admin/media` "Recently uploaded" for spot-checks.
- **Anyone can report media** ("Report photo" in the lightbox) → `pending_review` once there are ≥2 reports or an admin action.
- **Consent:** the vendor ticks "I have the client's permission to publish these photos" per album or upload batch (`consent_confirmed_at`).
- **Video links:** validated by URL pattern only (no API keys).
  - YouTube thumbnail: `https://i.ytimg.com/vi/{id}/hqdefault.jpg` (added to `images.remotePatterns`, or rendered with a plain `<img>`).
  - Instagram has no keyless thumbnail, so it gets a branded card with "Watch on Instagram". The embed iframe loads on click (`click-to-load` keeps pages fast and privacy-friendly).
  - A weekly link check is P3.

### 4.6 Display

- **Profile gallery** (`/vendors/[id]`): tabs "All photos" / album chips / "Videos". The grid uses the `card` variant with a placeholder colour and the lightbox uses `full`. Videos show as poster plus play button. MP4 plays in `<video controls preload="none">`; YouTube and Instagram are click-to-load iframes.
- **Offering detail** (modal or section): the offering's own cover plus media tagged with `service_id`.
- **Search card image fallback:**
  1. vendor cover,
  2. first featured approved image,
  3. first approved image,
  4. the category gradient from `lib/vendorVisuals.tsx`.

  Offering cards use the offering cover, then the vendor cover, then the same chain. A "▶ Video" badge appears when an approved video exists.
- **Search cards show up to 3 thumbnails** (cover plus 2 featured) on desktop, 1 on mobile.
- Only `approved` assets ever reach public queries. The owner's preview also shows `pending_review` items with a badge.

---

## 5. Data-model changes: migration `004_vendor_workspace.sql`

One additive migration. It has to be safe on the existing DB and work inside the runner's single transaction. `db/migrate.mjs` wraps each file in `BEGIN/COMMIT`, so a newly added enum value cannot be used in the same file. **We therefore convert `vendors.status` from enum to TEXT + CHECK**, consistent with 003's "CHECK rather than enum" choice. Billing moves to **`005_billing.sql`** (the spec's `003_billing.sql` name is taken).

```sql
-- 004_vendor_workspace.sql (outline)

-- A. vendors: lifecycle + business details --------------------------------
ALTER TABLE vendors ALTER COLUMN status DROP DEFAULT;
ALTER TABLE vendors ALTER COLUMN status TYPE TEXT USING status::text;
ALTER TABLE vendors ADD CONSTRAINT vendors_status_chk CHECK (status IN
  ('draft','pending','changes_requested','approved','rejected','suspended'));
ALTER TABLE vendors ALTER COLUMN status SET DEFAULT 'draft';     -- existing rows keep their value
ALTER TABLE vendors
  ADD COLUMN primary_category_id INT REFERENCES categories(id),
  ADD COLUMN legal_name TEXT, ADD COLUMN year_established SMALLINT CHECK (year_established BETWEEN 1900 AND 2100),
  ADD COLUMN team_size SMALLINT CHECK (team_size > 0), ADD COLUMN languages TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN address_line TEXT, ADD COLUMN landmark TEXT, ADD COLUMN pincode TEXT CHECK (pincode ~ '^[0-9]{6}$'),
  ADD COLUMN lat NUMERIC(9,6), ADD COLUMN lng NUMERIC(9,6),
  ADD COLUMN instagram_url TEXT, ADD COLUMN youtube_url TEXT, ADD COLUMN website_url TEXT,
  ADD COLUMN gstin TEXT CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'), ADD COLUMN fssai_no TEXT,
  ADD COLUMN travel_outside_kerala BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN max_events_per_day SMALLINT NOT NULL DEFAULT 1 CHECK (max_events_per_day BETWEEN 1 AND 50),
  ADD COLUMN attributes JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN onboarding_step SMALLINT NOT NULL DEFAULT 1, ADD COLUMN onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN submitted_at TIMESTAMPTZ, ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by INT REFERENCES users(id) ON DELETE SET NULL, ADD COLUMN status_reason TEXT,
  ADD COLUMN verified_at TIMESTAMPTZ, ADD COLUMN verified_by INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN founding_vendor BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN logo_media_id INT, ADD COLUMN cover_media_id INT,   -- FKs added after media_assets
  ADD COLUMN admin_notes TEXT;
-- logo_url / cover_image_url stay as a denormalised cache written by the media code.
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_price_chk;
ALTER TABLE vendors ADD CONSTRAINT vendors_price_nonneg_chk CHECK (price >= 0);  -- 0 = on request
UPDATE vendors v SET primary_category_id = c.id FROM categories c WHERE c.name = v.category AND v.primary_category_id IS NULL;
UPDATE vendors SET onboarding_completed_at = created_at, onboarding_step = 6 WHERE onboarding_completed_at IS NULL; -- grandfather
CREATE INDEX idx_vendors_status_submitted ON vendors (status, submitted_at);

CREATE TABLE vendor_status_events (            -- vendor-visible history
  id SERIAL PRIMARY KEY, vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL, to_status TEXT NOT NULL, reason TEXT,
  changed_by INT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON vendor_status_events (vendor_id, created_at DESC);

-- B. users: status, sessions, phone ----------------------------------------
ALTER TABLE users
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  ADD COLUMN suspended_at TIMESTAMPTZ, ADD COLUMN suspended_reason TEXT,
  ADD COLUMN session_version INT NOT NULL DEFAULT 0,
  ADD COLUMN phone_e164 TEXT CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ADD COLUMN whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN last_login_at TIMESTAMPTZ;

-- C. taxonomy ----------------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN slug TEXT, ADD COLUMN name_ml TEXT, ADD COLUMN icon TEXT, ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN default_price_unit TEXT NOT NULL DEFAULT 'event',
  ADD COLUMN allow_on_request BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN uses_slots BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN uses_inventory BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN attribute_schema JSONB NOT NULL DEFAULT '[]';   -- base fields for Other offerings
-- backfill slugs, then: ALTER COLUMN slug SET NOT NULL; CREATE UNIQUE INDEX ON categories(slug);
-- INSERT new categories (Traditional & Live Arts, Cakes & Desserts, Invitations & Printing,
-- Transport, Priest & Rituals, Gifts & Favours, Entertainment) ON CONFLICT (name) DO NOTHING;
-- UPDATE categories SET name='Decoration & Florist' WHERE name='Decoration'  -- AND vendors.category text in the same txn

CREATE TABLE offering_templates (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id),
  code TEXT NOT NULL,                       -- 'candid-photography'
  name TEXT NOT NULL, name_ml TEXT,
  kind TEXT NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit','addon')),
  default_price_unit TEXT NOT NULL,
  allowed_price_units TEXT[] NOT NULL,
  allow_on_request BOOLEAN NOT NULL DEFAULT false,
  attribute_schema JSONB NOT NULL DEFAULT '[]',  -- [{key,label,type:'int'|'bool'|'text'|'enum'|'multi',options?,required?,min?,max?,filterable?}]
  is_core BOOLEAN NOT NULL DEFAULT false,         -- shows in the Event Management checklist
  sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, code));

CREATE TABLE event_types (
  id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_ml TEXT,
  community TEXT, sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE event_type_categories (
  event_type_id INT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_core BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (event_type_id, category_id));

-- D. offerings (= services, extended) ---------------------------------------
ALTER TABLE services
  ADD COLUMN template_id INT REFERENCES offering_templates(id) ON DELETE SET NULL,
  ADD COLUMN custom_name TEXT,                 -- set when 'Other'
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit','package','addon')),
  ADD COLUMN sale_mode TEXT NOT NULL DEFAULT 'separate' CHECK (sale_mode IN ('separate','package_only')),
  ADD COLUMN fulfilment TEXT NOT NULL DEFAULT 'in_house' CHECK (fulfilment IN ('in_house','partner')),
  ADD COLUMN parent_service_id INT REFERENCES services(id) ON DELETE CASCADE,
  ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'from' CHECK (price_mode IN ('from','fixed','range','on_request')),
  ADD COLUMN price_to INT, ADD COLUMN unit_label TEXT,
  ADD COLUMN min_qty NUMERIC(10,2), ADD COLUMN max_qty NUMERIC(10,2), ADD COLUMN qty_step NUMERIC(10,2) NOT NULL DEFAULT 1,
  ADD COLUMN qty_owned INT CHECK (qty_owned >= 0),
  ADD COLUMN guest_min INT, ADD COLUMN guest_max INT,
  ADD COLUMN lead_time_days SMALLINT,
  ADD COLUMN inclusions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN attributes JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN cover_media_id INT,
  ADD COLUMN incomplete BOOLEAN NOT NULL DEFAULT false,      -- package with an inactive item
  ADD COLUMN hidden_reason TEXT,                             -- 'plan_limit' | 'admin' | NULL
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE services ADD CONSTRAINT services_price_unit_chk CHECK (price_unit IN
  ('event','package','day','hour','slot','plate','person','artist','item','set','kg','sqft','km','vehicle','session'));
ALTER TABLE services ADD CONSTRAINT services_range_chk CHECK (price_mode <> 'range' OR price_to >= price_from);
ALTER TABLE services ADD CONSTRAINT services_addon_chk CHECK ((kind = 'addon') = (parent_service_id IS NOT NULL));
ALTER TABLE services ADD CONSTRAINT services_package_sale_chk CHECK (kind <> 'package' OR sale_mode = 'separate');
ALTER TABLE services ADD CONSTRAINT services_qty_chk CHECK (min_qty IS NULL OR max_qty IS NULL OR max_qty >= min_qty);
ALTER TABLE services ADD CONSTRAINT services_guest_chk CHECK (guest_min IS NULL OR guest_max IS NULL OR guest_max >= guest_min);
CREATE INDEX idx_services_search ON services (category_id, active, kind, sale_mode, price_from);
CREATE INDEX idx_services_template ON services (template_id);
CREATE INDEX idx_services_attrs ON services USING GIN (attributes jsonb_path_ops);

CREATE TABLE package_items (
  package_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  qty NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0), note TEXT NOT NULL DEFAULT '', sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (package_id, item_id), CHECK (package_id <> item_id));
-- trigger package_items_same_vendor(): both rows same vendor_id, package kind='package', item kind IN ('unit','addon')

CREATE TABLE service_event_types (
  service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  event_type_id INT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, event_type_id));

CREATE TABLE custom_offering_requests (
  id SERIAL PRIMARY KEY,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id),
  raw_name TEXT NOT NULL, normalised_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','promoted','merged','kept_private','rejected')),
  resolved_template_id INT REFERENCES offering_templates(id), resolved_by INT REFERENCES users(id),
  resolved_at TIMESTAMPTZ, note TEXT, flagged_contact BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON custom_offering_requests (status, normalised_name);
ALTER TABLE offering_templates ADD COLUMN promoted_from_request_id INT REFERENCES custom_offering_requests(id);

-- E. media -------------------------------------------------------------------
CREATE TABLE media_albums (
  id SERIAL PRIMARY KEY, vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  event_type_id INT REFERENCES event_types(id), event_date DATE,
  district_id INT REFERENCES districts(id), venue_name TEXT,
  cover_media_id INT, consent_confirmed_at TIMESTAMPTZ,
  published BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE media_assets (
  id SERIAL PRIMARY KEY, uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  album_id INT REFERENCES media_albums(id) ON DELETE SET NULL,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL DEFAULT 'gallery' CHECK (purpose IN ('gallery','logo','cover','poster')),
  kind TEXT NOT NULL CHECK (kind IN ('image','video_file','video_link')),
  storage_driver TEXT CHECK (storage_driver IN ('local','s3','r2','supabase')),
  storage_key TEXT,                       -- base key; variants under it
  variants JSONB NOT NULL DEFAULT '{}',   -- {"thumb":{"key","w","h"},"card":{...},"full":{...}}
  external_url TEXT, external_provider TEXT CHECK (external_provider IN ('youtube','instagram','vimeo')),
  external_id TEXT, poster_media_id INT REFERENCES media_assets(id) ON DELETE SET NULL,
  mime TEXT, bytes INT, width INT, height INT, duration_s INT, sha256 TEXT, placeholder_color TEXT,
  caption TEXT NOT NULL DEFAULT '', alt_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN
    ('uploading','processing','pending_review','approved','rejected','hidden')),
  status_reason TEXT, reviewed_by INT REFERENCES users(id), reviewed_at TIMESTAMPTZ,
  report_count INT NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false, sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'video_link') = (external_url IS NOT NULL)),
  CHECK (kind = 'video_link' OR storage_key IS NOT NULL OR status = 'uploading'));
CREATE INDEX idx_media_vendor_public ON media_assets (vendor_id, status, purpose, sort_order);
CREATE INDEX idx_media_moderation ON media_assets (status, created_at);
CREATE UNIQUE INDEX uniq_media_sha_per_vendor ON media_assets (vendor_id, sha256) WHERE sha256 IS NOT NULL;
-- Add FKs: vendors.logo_media_id/cover_media_id, services.cover_media_id, media_albums.cover_media_id
--          -> media_assets(id) ON DELETE SET NULL.
-- Copy legacy rows: INSERT INTO media_assets (vendor_id, service_id, kind, external_url|storage_key..., status='approved')
--   SELECT ... FROM portfolio_items;  (portfolio_items kept read-only; dropped in a later migration)

CREATE TABLE media_reports (
  id SERIAL PRIMARY KEY, media_id INT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  reporter_id INT REFERENCES users(id) ON DELETE SET NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- F. areas, availability, team, documents ------------------------------------
CREATE TABLE vendor_service_areas (
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  district_id INT NOT NULL REFERENCES districts(id),
  travel_fee INT CHECK (travel_fee >= 0), travel_note TEXT,
  PRIMARY KEY (vendor_id, district_id));
CREATE INDEX ON vendor_service_areas (district_id);

CREATE TABLE vendor_availability (
  vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  slot TEXT NOT NULL DEFAULT 'full' CHECK (slot IN ('full','morning','evening')),
  status TEXT NOT NULL CHECK (status IN ('blocked','booked','tentative','limited')),
  capacity_total SMALLINT NOT NULL DEFAULT 1 CHECK (capacity_total >= 1),
  capacity_used SMALLINT NOT NULL DEFAULT 0 CHECK (capacity_used >= 0),
  quote_request_id INT REFERENCES quote_requests(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','booking')),
  note TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, date, slot));
CREATE INDEX ON vendor_availability (date, status);

CREATE TABLE vendor_team (
  id SERIAL PRIMARY KEY, vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', photo_media_id INT REFERENCES media_assets(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0);

CREATE TABLE vendor_documents (
  id SERIAL PRIMARY KEY, vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('gst','trade_licence','fssai','pan','aadhaar','other')),
  number TEXT, storage_driver TEXT NOT NULL, storage_key TEXT NOT NULL,   -- under private/
  mime TEXT NOT NULL, bytes INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expired')),
  expires_at DATE, reviewed_by INT REFERENCES users(id), reviewed_at TIMESTAMPTZ, note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON vendor_documents (status, created_at);

-- G. enquiries: context, line items, offers, thread ----------------------------
ALTER TABLE quote_requests DROP CONSTRAINT quote_status_chk;
ALTER TABLE quote_requests ADD CONSTRAINT quote_status_chk CHECK (status IN
  ('pending','responded','accepted','booked','declined','withdrawn','expired'));
ALTER TABLE quote_requests
  ADD COLUMN event_type_id INT REFERENCES event_types(id),
  ADD COLUMN district_id INT REFERENCES districts(id),        -- event location (analytics)
  ADD COLUMN venue_text TEXT, ADD COLUMN venue_type TEXT CHECK (venue_type IN ('home','hall','church','temple','mosque','office','outdoor','other')),
  ADD COLUMN guest_count INT CHECK (guest_count BETWEEN 1 AND 100000),
  ADD COLUMN budget_min INT, ADD COLUMN budget_max INT,         -- legacy budget TEXT kept
  ADD COLUMN slot TEXT CHECK (slot IN ('full','morning','evening')),
  ADD COLUMN event_end_date DATE,
  ADD COLUMN food_pref TEXT CHECK (food_pref IN ('veg','non_veg','both')),
  ADD COLUMN preferred_contact TEXT NOT NULL DEFAULT 'whatsapp' CHECK (preferred_contact IN ('call','whatsapp','email')),
  ADD COLUMN contact_email TEXT,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','whatsapp_click','multi','admin')),
  ADD COLUMN guest_token UUID UNIQUE, ADD COLUMN batch_id UUID,
  ADD COLUMN vendor_notes TEXT, ADD COLUMN follow_up_at DATE,
  ADD COLUMN customer_withdrawn_at TIMESTAMPTZ;
CREATE INDEX ON quote_requests (vendor_id, status, created_at DESC);
CREATE INDEX ON quote_requests (district_id, event_type_id, created_at);
ALTER TABLE quote_request_services
  ADD COLUMN qty NUMERIC(10,2), ADD COLUMN note TEXT,
  ADD COLUMN snapshot JSONB NOT NULL DEFAULT '{}';   -- title/price/unit at request time

CREATE TABLE quote_offers (
  id SERIAL PRIMARY KEY, quote_request_id INT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  version SMALLINT NOT NULL, created_by INT REFERENCES users(id),
  subtotal_paise BIGINT NOT NULL, travel_paise BIGINT NOT NULL DEFAULT 0,
  discount_paise BIGINT NOT NULL DEFAULT 0, gst_paise BIGINT NOT NULL DEFAULT 0,   -- >0 only if vendor has gstin (app rule)
  total_paise BIGINT NOT NULL, advance_pct SMALLINT CHECK (advance_pct BETWEEN 0 AND 100),
  valid_until DATE, terms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined','superseded','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), responded_at TIMESTAMPTZ,
  UNIQUE (quote_request_id, version));
CREATE TABLE quote_offer_lines (
  id SERIAL PRIMARY KEY, offer_id INT NOT NULL REFERENCES quote_offers(id) ON DELETE CASCADE,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  label TEXT NOT NULL, qty NUMERIC(10,2) NOT NULL CHECK (qty > 0), unit TEXT NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise >= 0), amount_paise BIGINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0);
CREATE TABLE quote_messages (
  id SERIAL PRIMARY KEY, quote_request_id INT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer','vendor','admin','system')),
  sender_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000), read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON quote_messages (quote_request_id, created_at);

-- H. reviews -------------------------------------------------------------------
ALTER TABLE vendor_reviews
  ADD COLUMN quote_request_id INT REFERENCES quote_requests(id) ON DELETE SET NULL,
  ADD COLUMN event_type_id INT REFERENCES event_types(id),
  ADD COLUMN vendor_reply TEXT, ADD COLUMN vendor_reply_at TIMESTAMPTZ,
  ADD COLUMN hidden_at TIMESTAMPTZ, ADD COLUMN hidden_by INT REFERENCES users(id), ADD COLUMN hidden_reason TEXT;
ALTER TABLE review_reports
  ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  ADD COLUMN resolved_by INT REFERENCES users(id), ADD COLUMN resolved_at TIMESTAMPTZ, ADD COLUMN resolution_note TEXT;
CREATE INDEX ON review_reports (status, created_at);

-- I. admin & analytics -----------------------------------------------------------
CREATE TABLE admin_audit_log (
  id BIGSERIAL PRIMARY KEY, actor_id INT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                 -- 'vendor.approve','review.hide','user.suspend','taxonomy.promote',...
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  before JSONB, after JSONB, reason TEXT, ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON admin_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX ON admin_audit_log (created_at DESC);
-- trigger rejecting UPDATE/DELETE on admin_audit_log (append-only)

CREATE TABLE vendor_events (           -- raw counters; aggregate later
  id BIGSERIAL PRIMARY KEY, vendor_id INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('profile_view','whatsapp_click','phone_reveal','search_impression')),
  district_id INT REFERENCES districts(id), service_id INT REFERENCES services(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON vendor_events (vendor_id, kind, created_at);

CREATE TABLE blocked_contacts (
  id SERIAL PRIMARY KEY, value TEXT UNIQUE NOT NULL,   -- normalised phone or lower(email)
  reason TEXT NOT NULL, created_by INT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE notifications (           -- in-app now; channels later
  id BIGSERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}', read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON notifications (user_id, read_at, created_at DESC);

-- J. seeds: categories (19), offering_templates (~150 rows), event_types (15), event_type_categories.
```

**Migration rules:**

- Every statement is idempotent: `IF NOT EXISTS`, plus `DO $$ … EXCEPTION WHEN duplicate_object` for constraints.
- Existing approved vendors stay approved and visible.
- `portfolio_items` rows are copied once (guarded by `schema_migrations`, as in 003).
- `npm run db:migrate` must succeed twice in a row on a fresh DB and on the seeded dev DB.

**`005_billing.sql`** (P3, schema can land earlier): exactly MONETIZATION_SPEC §6, plus `plans.max_albums`, `max_video_links` and `max_video_files`. `vendors.founding_vendor` and `gstin` already come from 004, and `quote_requests.source` too.

**Deferred tables:** `complaints` and `complaint_notes` (P3), `events` and `event_members` boards (P3), `service_price_slabs` and `service_slots` (P3), `otp_codes` (P3), and `content_pages` (P3).

---

## 6. API changes

Conventions:

- JSON in and out. Errors are returned as `{error, code}`, using codes such as `PLAN_LIMIT`, `PACKAGE_ONLY`, `FORBIDDEN` and `VALIDATION`.
- Every handler starts with `requireRole(...)`.
- Rate limits use `lib/rate-limit.ts`.
- `/api/vendor/*` always resolves the caller's own vendor from the session. It **never takes a vendorId from the client.**

### Auth and meta

| Method | Route | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | change: returns `{redirectTo}` by role (2.6); sets `last_login_at`; rejects suspended users |
| POST | `/api/auth/register` | public | change: optional `phone`, vendor type. Vendor gets `redirectTo:/vendor/onboarding` |
| GET | `/api/meta/taxonomy` | public | **single source of truth**: categories, templates with attribute schemas, price units with labels, event types, districts. Replaces the hard-coded `CATEGORIES` merge |
| GET | `/api/me` | any logged-in | session user, role, vendor summary (status, onboarding step), unread counts |

### Vendor workspace (`role=vendor`)

| Method | Route | Purpose |
|---|---|---|
| GET/PATCH | `/api/vendor/listing` | read and update business profile fields. PATCH accepts onboarding step payloads and `onboarding_step` |
| POST | `/api/vendor/listing` | create a draft listing (first wizard step). 409 if one exists |
| POST | `/api/vendor/listing/submit` | validate the minimum to submit (basics, ≥1 priced separately-sellable offering or package, logo or cover, ≥3 images) → `pending`, `submitted_at` |
| GET/PUT | `/api/vendor/areas` | served districts with travel fee and note (replaces the whole set) |
| GET/POST | `/api/vendor/offerings` | list (all kinds) / create a unit, addon or custom. Validates attributes against the schema; enforces `max_services` |
| GET/PATCH/DELETE | `/api/vendor/offerings/[id]` | edit, activate, deactivate (marks dependent packages `incomplete`), delete (soft if referenced by enquiries) |
| POST | `/api/vendor/offerings/reorder` | `{ids:[...]}` |
| POST/PATCH | `/api/vendor/packages`, `/api/vendor/packages/[id]` | create or update a package with `items:[{serviceId, qty, note}]` |
| GET | `/api/vendor/media` | assets and albums with usage versus limits |
| POST | `/api/vendor/media/uploads` | step 1: reserve (4.4) |
| PUT | `/api/vendor/media/uploads/[id]/file` | local driver byte upload (size-capped stream) |
| POST | `/api/vendor/media/uploads/[id]/complete` | step 3: validate, process, finalise |
| POST | `/api/vendor/media/links` | add a YouTube / Instagram / Vimeo link |
| PATCH/DELETE | `/api/vendor/media/[id]` | caption, alt, album, offering, featured, order / delete |
| PUT | `/api/vendor/media/logo`, `/api/vendor/media/cover` | `{mediaId}` set (also writes the `logo_url` / `cover_image_url` cache) |
| GET/POST/PATCH/DELETE | `/api/vendor/albums[/id]` | album CRUD and consent |
| GET | `/api/vendor/home` | home aggregates: status, checklist, new leads, upcoming bookings, 7-day stats |
| GET | `/api/vendor/leads` | filters `status, from, to, district, serviceId`; includes event context and selected units. Billing hook: `locked` once billing is on |
| GET/PATCH | `/api/vendor/leads/[id]` | detail / `status`, `vendor_notes`, `follow_up_at`. Marking booked creates or updates `vendor_availability` |
| POST | `/api/vendor/leads/[id]/offers` | send itemised offer vN (supersedes previous) (P2) |
| POST | `/api/vendor/leads/[id]/messages` | thread message (P2) |
| GET/PUT | `/api/vendor/availability?month=` | read the month / upsert or clear blocks (warns about pending leads on that date) (P2) |
| POST | `/api/vendor/reviews/[id]/reply` | one public reply, editable for 7 days (P2) |
| GET/POST/DELETE | `/api/vendor/documents[/id]` | private doc upload (PDF/JPEG/PNG ≤10 MB) (P1) |
| GET | `/api/vendor/insights?range=` | counts from `vendor_events` and `quote_requests` (P2) |

Legacy `/api/vendors/[id]/services`, `/api/services/[id]` and the vendor PATCH on `/api/vendors/[id]` stay working as thin wrappers until P0 ships, then are removed in P0-14 cleanup.

### Public and customer

| Method | Route | Role | Purpose |
|---|---|---|---|
| GET | `/api/vendors` | public | change: `view=vendors\|offerings`, `offering` (template code), `eventType`, `district` matched against served districts, `date` (exclude blocked), `budgetMax` and `priceUnit` (service-level), `guests`, `verified`. Ranking: featured → rank boost → rating → completeness |
| GET | `/api/vendors/[id]` | public | change: offerings tree (units, packages with items, addons), approved media and albums, service areas, review replies. Owner and admin get pending items. |
| POST | `/api/vendors/[id]/quotes` | public/customer | change: v2 enquiry fields. Validates `serviceIds` belong to the vendor, are active and are not package-only alone. E.164 phone. Guest gets `guest_token`. Writes service snapshots. Blocked-contact and rate checks. |
| POST | `/api/enquiries/multi` | public/customer | `{vendorIds≤5, ...}` fan-out with one `batch_id`. Per-vendor result. Max 15/day per phone (P2) |
| GET | `/api/enquiries/track/[token]` | guest | guest view of their enquiry (P2) |
| POST | `/api/vendors/[id]/events` | public | `{kind:'profile_view'\|'whatsapp_click'}` beacon (deduped per session) |
| POST | `/api/media/[id]/report` | public | report media |
| GET | `/api/my/enquiries`, `/api/my/enquiries/[id]` | customer (+vendor own) | list / thread with offers |
| PATCH | `/api/my/enquiries/[id]` | customer | `withdraw` / `accept offer {offerId}` / `decline offer` / `mark booked` |
| POST | `/api/my/enquiries/[id]/messages` | customer | thread message |
| GET/POST/DELETE | `/api/my/shortlist` | customer | favourites with `note`, merging guest localStorage on login |
| POST | `/api/vendors/[id]/reviews` | customer | change: verified = linked enquiry status `booked` (or `accepted`) **and** event_date < today. Otherwise allowed as unverified only if an enquiry exists. |
| GET/PATCH | `/api/notifications` | logged-in | list / mark read (P2) |

### Admin (`role=admin`; every mutating route writes `admin_audit_log`)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/today` | queue counts and oldest items |
| GET | `/api/admin/vendors` | queue and search (`status, district, category, q`) plus duplicate hints (same phone, WhatsApp or normalised name in the same district) |
| GET/PATCH | `/api/admin/vendors/[id]` | full detail / edit fields on the vendor's behalf |
| POST | `/api/admin/vendors/[id]/decision` | `{action:'approve'\|'request_changes'\|'reject'\|'suspend'\|'unsuspend', reason}`. Optimistic: `WHERE status = $expected`, returning 409 "already handled" |
| POST | `/api/admin/vendors/[id]/verify` | set or clear `verified_at` |
| POST | `/api/admin/vendors/[id]/owner` | assign a seeded listing to a vendor user (claim) |
| GET/POST | `/api/admin/reviews/reports`, `/api/admin/reviews/[id]/hide`, `/unhide`, `/api/admin/reports/[id]/dismiss` | review moderation and rating recompute |
| GET/POST | `/api/admin/media`, `/api/admin/media/[id]/decision` | approve / reject with reason |
| CRUD | `/api/admin/categories`, `/api/admin/templates`, `/api/admin/event-types` | taxonomy. Deactivating a category that has active offerings → 409 |
| GET/POST | `/api/admin/custom-offerings`, `/api/admin/custom-offerings/resolve` | `{ids, action:'promote'\|'merge'\|'keep_private'\|'reject', templateId?, newTemplate?}` |
| GET/PATCH | `/api/admin/users`, `/api/admin/users/[id]` | search / `suspend`, `unsuspend`, `force_logout` (bumps `session_version`). Self-action blocked, last active admin protected. |
| GET/POST | `/api/admin/documents/[id]`, `/file`, `/decision` | stream a private file / verify or reject, expiry |
| GET/POST | `/api/admin/enquiries`, `/api/admin/blocked-contacts` | monitor / block |
| GET | `/api/admin/analytics?range=` | aggregates |
| GET | `/api/admin/audit` | paged log |

Infra: `app/media/[...key]/route.ts` (public file serving, local driver) and `npm run admin:create -- --email --name` (script, not a route).

---

## 7. UI changes per role

### Public

- **Home:**
  - The hero search becomes "What" (category or offering autocomplete), "Where" (district) and "When" (date, optional).
  - Event-type chip row (Wedding, Nikah, Church wedding, Engagement, Birthday, Baptism, Housewarming, Noolukettu, Onam/Corporate, College fest).
  - Category chips from `/api/meta/taxonomy`.
  - Cards with real cover images.
- **Search:**
  - Filter sheet on mobile: category, offering (chips from templates), district ("include vendors who travel"), date, budget presets per unit (catering shows per plate), guests, rating, verified.
  - A "Vendors / Offerings" toggle. Offering cards read "Candid photography · ₹45,000 / event · by Lens & Light, Thrissur".
  - The empty state suggests nearby districts.
- **Vendor profile:**
  - Cover hero with logo, then badges (Verified business, Founding Vendor, years, languages, "Travels to …").
  - Sticky mobile bar (WhatsApp, Get quote).
  - Sections: Offerings grouped by category (units, packages with "includes", add-ons; package-only units listed under "Included in packages"), Gallery (albums, videos), Service areas, Reviews (with vendor replies, verified tag), About, Team (P3).
  - The quote dialog opens with the clicked offering pre-selected, and includes event type, guests, district, venue type, budget band, slot, food preference (catering), and qty per unit with a min-qty warning.
  - "Preview, not public yet" ribbon for owners.
- **Signup:** a role choice card (I'm planning an event / I'm a vendor). The vendor path goes straight into onboarding step 1.

### Customer

- `/my` home: next event card (from the latest enquiry date), replies awaiting action, shortlist, "still needed" categories for the event type.
- Enquiry list and thread with offer cards (line items, totals, GST only if present, validity, advance %, Accept / Decline), a message composer and a status timeline.
- Shortlist with notes, "Send enquiry to selected", and Compare.
- The header described in 2.7. No vendor CTAs.

### Vendor

- **Onboarding wizard** (`/vendor/onboarding`), one screen per step, phone-first, saved per step, resumable:
  1. **About you:**
     - Type: Company / Individual / Small team.
     - Business name, legal name (company), primary category, home district and town, phone and WhatsApp (E.164, defaults to +91), year started, team size, languages.
  2. **What you offer:**
     - Pick categories. Event Management shows the unit checklist (3.3).
     - Each ticked unit: sale mode toggle (Bookable separately / Package only), in-house or partner. "Other" lets you add a custom name.
  3. **Prices & details:**
     - Per selected offering, a compact card: price mode, price, unit, min qty and the 2–4 *required* attributes from the template schema.
     - Optional attributes stay for later.
     - "Create a package from these" shortcut.
  4. **Where you work:** served districts multi-select with travel fee or note.
  5. **Photos & videos:**
     - Logo, cover, ≥3 images (≥6 recommended), optional video links.
     - Upload one file at a time with progress, plus a consent checkbox.
  6. **Review & submit:**
     - Preview card plus checklist.
     - Submit takes the listing to "Under review".
     - The vendor can still edit anything while it is pending.
- **Home** (`/vendor`):
  - Status banner:
    - Draft: "Finish step N"
    - Pending: "Under review, usually within 24 h"
    - Changes requested: the admin's note plus "Fix & resubmit"
    - Live
    - Suspended: reason and contact
  - Profile-strength meter (logo, cover, 6+ photos, 3+ offerings, a package, service areas, about ≥150 chars, documents).
  - New leads list (5), upcoming booked dates, 7-day views / WhatsApp clicks / enquiries, quick actions (Add offering, Upload photos, Block a date).
  - No customer favourites or "My requests" here.
- **Offerings:** list grouped by category with chips (Separate / Package only / Add-on / Custom: under review / Incomplete package). The editor's attribute form is rendered from the schema (int, bool, enum, multi, text). The package composer has a unit picker, qty, inclusions, guest range and price.
- **Media:** grid with status pills (Under review / Hidden: over plan limit / Rejected: reason), drag-to-reorder (with an up/down button fallback for accessibility), album management, logo and cover croppers (client-side canvas crop), and a usage meter ("32 of 50 photos").
- **Leads:**
  - Inbox with status tabs (New, Quoted, Accepted, Booked, Declined, Expired) and filters.
  - Lead detail shows the event context and the requested units with quantities and price snapshots.
  - Actions:
    - P0: mark responded / booked / declined, notes and follow-up, WhatsApp click-to-chat with a prefilled message.
    - P2: offer builder (lines pre-filled from the requested units × qty, travel from the service area, GST line only if the vendor has a GSTIN).
- **Calendar (P2):** month grid. Tap a day to block it, choose a slot or set capacity ("2 teams"). Booked days are linked to leads. Bulk block a range (Ramadan, monsoon).

### Admin

Phone-friendly list and detail views throughout. Every decision opens a reason dialog (required for reject, request changes, suspend and hide). Toasts include "Undo" where the action is reversible, which writes a second audit row.

- **Vendor detail:**
  - Two columns on desktop, stacked on mobile.
  - Profile preview, offerings with custom flags, media strip with approve/reject, documents with a file viewer, duplicate warnings, status history, audit trail.
  - Action bar: Approve (+Verified), Request changes, Reject, Suspend.
- **Taxonomy:**
  - Category list with an inline editor.
  - Template editor with an attribute-schema builder (rows of key / label / type / options / required / filterable), validated so keys never change once in use.
  - Event-type bundles editor.
  - Custom queue grouped by normalised name with vendor count and sample vendors.

---

## 8. Prioritised build plan

Every item ends with **acceptance criteria (AC)** that can be checked by API tests (`tests/api.test.mjs`) or Playwright e2e (`web/e2e`). An item is not done until `npm run typecheck`, `npm run lint`, the API tests and the e2e tests pass. No live services are used: local Postgres, the local disk storage driver and `BILLING_ENABLED=false`.

### P0: Vendor workspace

> **Status (2026-10-31, local commits on `ui-fixes-aswin`):** P0-1 to P0-16 built. Wave 1 (f13472f): migration 004, taxonomy, storage and media API, role guards, vendor nav. Wave 2: onboarding wizard (P0-10), offerings and packages (P0-11), vendor home (P0-12), profile and service areas (P0-13), leads inbox at `/vendor/leads` (P0-14), public gallery/lightbox/offerings and search-card covers (P0-15), seed archetypes with generated media in `db/fixtures/media` plus API and e2e tests (P0-16). Open follow-ups: cover/logo crop, multi-thumbnail search cards, "Report photo", offering-detail media, search by offering/district, `media:cleanup`, switching the remaining `CATEGORIES` users to `getTaxonomy()`, the plan's 6 lead tabs (DB has 4 statuses), and a "Small team" business type. Final review: 14 of 16 items ticked below; P0-7 (crop) and P0-8 (legacy CATEGORIES users) stay open. /media now hides unapproved media from everyone except the owning vendor and admins.

[x] **P0-1 Migration 004 and seeds.** Write `004_vendor_workspace.sql` per section 5, with seeds for 19 categories, offering templates (all of 3.4), 15 event types and their bundles. _Status: Migration 004 applied locally (fresh + rerun no-op), seeds for categories, templates and event types; portfolio_items copied to media_assets._
AC:
- Migration applies on a fresh DB and on the current dev DB.
- Re-running is a no-op.
- Existing approved vendors still appear in `/search`.
- `portfolio_items` rows are present in `media_assets` with `status='approved'`.
- Inserting an addon without a parent, a range with `price_to < price_from`, or a package item from another vendor fails.
- An UPDATE on `admin_audit_log` fails.

[x] **P0-2 Role guards and role-based landing.** Add `requireRole()` in `app/api/_lib/auth.ts` (checks role, `status`, `session_version`), `web/proxy.ts`, layout guards for `/my`, `/vendor` and `/admin`, login/register `redirectTo`, and the `/dashboard/*` redirects. _Status: requireRole() + proxy.ts + layout guards; role-based landing and the 2.6 redirect table are covered by e2e._
AC:
- Vendor login lands on `/vendor`, or `/vendor/onboarding` if not completed.
- Customer login lands on `/my` (or `/` until P2-1 ships the page; the redirect target is configurable in one constant).
- Admin login lands on `/admin`.
- A customer GET on `/vendor/leads` is redirected to `/my`.
- A non-admin GET on `/admin` returns 404.
- A customer calling `/api/vendor/*` gets 403.
- Every redirect in the 2.6 table is covered by an e2e test.
- A `next` param pointing to another role's area is ignored.

[x] **P0-3 Role-specific headers and navigation.** One header with four configs (2.7), the vendor mobile bottom tab bar and the onboarding minimal header. _Status: Four header configs, vendor bottom tabs with a More sheet, status chip; checked at 390px in e2e._
AC:
- Snapshot tests for each role confirm that customers never see "For vendors" in the header and vendors see Leads, Offerings and Media.
- The status chip reflects `vendors.status`.
- There is no horizontal scroll at 360 px.
- Every nav item is keyboard reachable with a visible focus ring.

[x] **P0-4 Storage adapter and local driver.** `lib/storage/{types,index,local}.ts` and `app/media/[...key]/route.ts` with Range support. Add `uploads/` to `.gitignore`. _Status: StorageAdapter + LocalDiskAdapter, /media with Range 206, traversal 400, private/ 404; review fix: media that isn't approved (and raw upload.bin) now 404s for everyone but the owning vendor and admins, served `private, no-store`._
AC:
- Unit test: put → get → publicUrl → delete round-trip.
- A `/media/..%2f..` traversal returns 400.
- `private/` keys return 404 through `/media`.
- A Range request returns 206 with the correct bytes.
- Switching `STORAGE_DRIVER` to an unknown value fails fast at startup with a clear error.

[x] **P0-5 Image upload pipeline.** Add the `sharp` dependency. Build the reserve / put / complete endpoints, magic-byte validation, variants, EXIF strip, sha256 dedupe, the entitlements stub `lib/entitlements.ts` (`getVendorEntitlements` returning Pro while `BILLING_ENABLED` is false) and moderation status rules (4.5). _Status: sharp pipeline: reserve/put/complete, magic bytes 415, 15 MB 413, thumb/card/full WebP without EXIF, sha256 dedupe, pending vs approved, entitlements stub._
AC:
- A 12 MB JPEG produces thumb, card and full WebP files with no EXIF (verified by reading the metadata back).
- A PNG renamed `.jpg` is accepted, while a PDF renamed `.jpg` is rejected with 415.
- Files over 15 MB are rejected with 413.
- Uploading the same file twice returns `duplicate:true` and creates one row.
- The 51st image returns 402 `PLAN_LIMIT`.
- Media from a pending vendor is `pending_review`, and from an approved vendor is `approved`.
- Another vendor's asset id returns 404.

[x] **P0-6 Video links and small MP4.** Links endpoint with a YouTube/Instagram/Vimeo parser. MP4 via the same pipeline (size and type), poster upload, and the `MEDIA_VIDEO_UPLOADS` env flag (default true locally, false in production). _Status: YouTube/Shorts/youtu.be/Instagram/Vimeo link parser (others 400), MP4 via the pipeline with Range seeking, MEDIA_VIDEO_UPLOADS flag._
AC:
- `youtu.be/ID`, `youtube.com/shorts/ID` and `instagram.com/reel/ID` all parse.
- `example.com/video` gets 400.
- Link and file counts are enforced against limits.
- A 60 MB MP4 gets 413.
- MP4 plays and seeks on the profile.
- With the flag off, the upload UI is hidden and the API returns 403.

[ ] **P0-7 Media manager UI** (`/vendor/media`). Grid, albums, logo and cover crop, captions, featured, reorder, delete, consent checkbox, usage meter, per-file progress and retry. _Status: Grid, albums, captions, cover/logo, reorder, delete and per-file retry work at 390px. Missing: cover/logo crop._
AC (e2e):
- Upload 3 images, create an album, set the cover, reorder, delete one.
- The public profile (owner preview) reflects every change.
- A failed upload shows Retry without blocking the others.
- It works at 360 px width.

[ ] **P0-8 Taxonomy API as single source of truth.** `/api/meta/taxonomy`. Remove the hard-coded category merging in `lib/vendorVisuals.tsx` and `api/vendors/route.ts` (keep visuals keyed by slug only). _Status: /api/meta/taxonomy feeds the wizard, offerings and filters. Missing: home page, search filters, /api/suggest and the legacy /api/vendors/[id] still read the hard-coded CATEGORIES list._
AC:
- Every category list in the UI (home chips, search filter, wizard) comes from the API.
- Adding a category row in the DB shows it everywhere without a code change.
- The response is cached (revalidate 300 s).

[x] **P0-9 Attribute schema validation.** `lib/offering-validation.ts` replaces and extends `lib/service-validation.ts`, validating `attributes` against the template schema (or the category base schema for custom), plus price mode, unit, qty and on-request rules. _Status: lib/offering-validation.ts validates attributes per template schema, strips unknown keys, enforces price mode/unit/on-request rules (unit tests)._
AC:
- Unit tests per field type.
- An unknown attribute key is stripped.
- A missing required attribute returns 400 with the field name.
- `on_request` on a template that doesn't allow it gets 400.
- A unit outside `allowed_price_units` gets 400.

[x] **P0-10 Onboarding wizard** (`/vendor/onboarding`, 6 steps per section 7). Draft listing created at step 1 (`status='draft'`). Each step PATCHes and saves `onboarding_step`. Submit validates the minimum and moves to `pending`. _Status: 6-step wizard saved per step with resume, event-company checklist, submit gate (basics + priced unit + logo/cover + 3 images), owner preview._
AC (e2e):
- An individual photographer and an event company (with the EM checklist: 4 units, one package-only) each complete the wizard.
- Closing the browser at step 3 and logging in again resumes at step 3.
- Submitting without 3 images is blocked with a clear message.
- After submit the listing is `pending` and **not** in public search.
- The owner preview works.
- The wizard can be used fully with the keyboard.

[x] **P0-11 Offerings and packages manager.** `/vendor/offerings` list and editor, Other/custom (creates a `custom_offering_requests` row, masks contact details), sale mode, fulfilment, add-ons, package composer, `incomplete` marking. _Status: Offerings and packages manager: Other -> custom_offering_requests with contact masking, package composer from own units, incomplete marking, cross-vendor items 400, vendors.price recomputed._
AC:
- Creating "Other: Kolkali team" creates both the offering and a request row.
- Typing a phone number into a custom name masks it and sets `flagged_contact`.
- Deactivating a unit used in a package sets the package `incomplete` and hides it publicly.
- Package items from another vendor get 400.
- `vendors.price` and `price_label` recompute to the cheapest separately-sellable priced offering.

[x] **P0-12 Vendor home** (`/vendor`). Status banner for all 6 statuses, profile-strength checklist, new leads, upcoming bookings, 7-day stats, quick actions. _Status: /vendor home: banner for all 6 statuses, profile-strength checklist, new leads, bookings, 7-day stats._
AC:
- Each status shows the right banner and CTA (fixture per status).
- The checklist percentage matches the rule set.
- No customer data (favourites, "my requests") is queried. Asserted by API response shape.

[x] **P0-13 Business profile and service areas** (`/vendor/profile`, `/vendor/areas`). Edit all business fields. Editing name, category or phone on an approved listing records a re-review flag (admin queue), while the listing stays live. _Status: Business profile and service areas with GSTIN/pincode/E.164 validation, districts + travel on the public profile, re-review flag on name/category/phone edits._
AC:
- GSTIN, pincode and E.164 validation.
- Served districts are saved and shown on the profile with travel notes.
- An approved vendor renaming appears in the admin "re-review" list (verified once P1-3 lands; the flag column is asserted now).

[x] **P0-14 Leads inbox move and cleanup** (`/vendor/leads`, `/vendor/leads/[id]`). Port the existing leads UI. Show requested units with quantity and snapshot, notes, follow-up date, WhatsApp click-to-chat. Marking booked writes `vendor_availability`. Remove the vendor branches from `/dashboard` and the legacy routes. _Status: /vendor/leads with event context, unit snapshot, notes, follow-up, wa.me; booked writes availability; own leads only; /dashboard is redirects only. Follow-ups: the plan's 6 lead tabs (DB has 4 statuses), in-page confirm instead of window.confirm, 404 status (not 200) on another vendor's lead/package page._
AC:
- A lead shows event type, guests, district and units when provided.
- Status changes still write `quote_status_events`.
- A vendor sees only their own leads (403 on others).
- The `/dashboard` files are gone except the redirects.

[x] **P0-15 Public display of real media and offerings.** Profile gallery (albums, videos, lightbox), offerings tree, search card image fallback chain, package-only enforcement in the quote API, `next.config` `images.remotePatterns` for `i.ytimg.com`. _Status: Public gallery with albums, lightbox, tap-to-load videos, offerings grouped by unit with Bookable separately badge, search-card cover fallback, PACKAGE_ONLY 400, unit-only enquiries._
AC:
- A vendor with uploaded media shows it on the profile and search card.
- A vendor without media shows the gradient fallback.
- Pending or rejected media never appears in the anonymous HTML.
- An enquiry with only a package-only service gets 400 `PACKAGE_ONLY`.
- An enquiry for a separately-sellable unit of an event company works and the vendor sees only that unit.

[x] **P0-16 Test and fixture pack.** Seed script fixtures for 6 vendor archetypes (event company, photographer, caterer, venue, chenda troupe, rental) with media files in `db/fixtures/media`. Extend the API tests and e2e per item above. _Status: Seed: 12 vendors incl. the 6 archetypes with generated media in db/fixtures/media imported through the storage adapter; test:unit, test:storage, test:api and test:e2e green._
AC:
- `npm run db:seed` creates the archetypes with images on the local driver.
- The full test suite is green in CI.

### P1: Admin area

**P1-1 Admin bootstrap and guard.** `npm run admin:create` script, `/admin` layout (noindex, no-store), `requireRole('admin')` on all `/api/admin/*`, suspension and `session_version` enforcement in `getLiveSession`.
AC:
- The script creates or promotes an admin idempotently.
- Register can never create an admin.
- A suspended user's existing cookie is rejected on the next request.
- `force_logout` invalidates the cookie.

**P1-2 Audit log.** `lib/audit.ts` `audit(actor, action, entity, before, after, reason)` called inside the same transaction as each admin mutation, plus the `/admin/audit` viewer with filters.
AC:
- Every `/api/admin/*` mutation test asserts exactly one audit row.
- Audit rows cannot be updated or deleted (DB trigger).

**P1-3 Vendor approval queue and detail.** `/admin/vendors` and `[id]`: approve / request changes / reject / suspend / unsuspend with reason, verified badge, duplicate hints, re-review list, vendor status events, notification to the vendor (in-app).
AC:
- Approving a pending vendor makes it public and approves its pending media in the same transaction.
- Request-changes shows the note on the vendor home, and resubmission returns the listing to pending.
- Two concurrent approvals give one success and one 409.
- Suspending hides the listing at once and blocks the vendor's login.

**P1-4 Today inbox** (`/admin`). Counts and oldest item for each queue (vendors pending, re-review, review reports, media, custom offerings, documents).
AC:
- Counts match the fixture data.
- Each tile links to its filtered queue.
- The page loads in under 300 ms on the seed DB.

**P1-5 Review moderation.** Reports queue; hide / unhide / dismiss; rating and count recomputed on top of `seed_rating` / `seed_reviews_count`.
AC:
- Hiding a 1★ review raises the displayed rating correctly (fixture maths).
- Hidden reviews are absent from public pages and APIs.
- Reports move to `actioned` or `dismissed`.

**P1-6 Media moderation.** `/admin/media` with tabs Pre-moderation / Recently uploaded / Reported; approve or reject with reason; the vendor sees the reason.
AC:
- A rejected asset disappears from public pages.
- 2 reports move an approved asset to `pending_review`.
- Actions are audited.

**P1-7 Taxonomy manager.** CRUD for categories, templates (schema builder) and event types/bundles.
AC:
- A new template appears in the wizard and filters without a deploy.
- Changing the key of an attribute in use is blocked.
- Deactivating a category with active offerings gets 409.

**P1-8 Custom offering queue.** Grouped by normalised name; promote / merge / keep private / reject in one transaction.
AC:
- Promoting "kolkali" re-points all 3 fixture vendors' offerings to the new template and makes it a filter chip.
- Rejecting hides the offering and notifies the vendor.

**P1-9 User management.** Search by email or phone, view role and linked listing, suspend / unsuspend / force logout.
AC:
- An admin cannot suspend themselves or the last active admin.
- A suspended vendor's listing is hidden.
- Actions are audited.

**P1-10 Vendor documents and verification.** Vendor upload page (`/vendor/documents`, private storage), admin viewer that streams through an admin-only route, verify / reject with expiry, "Verified business" badge rule (≥1 verified doc plus an admin verify action).
AC:
- A document URL is never reachable without an admin session (404 via `/media`, 403 via the API for non-admins).
- An expired FSSAI shows "Licence expired" to the vendor but does not unpublish.

**P1-11 Admin vendor edit and claim.** Edit any vendor field on the vendor's behalf (audited). Assign a seeded `owner_id NULL` listing to a vendor user who has no listing.
AC:
- The edit shows before and after in the audit log.
- Assigning to a user who already owns a listing gets 409 (one listing per account).
- After the claim, the vendor lands on `/vendor` with that listing.

**P1-12 Analytics and event capture.** `vendor_events` beacons (profile view, WhatsApp click). `/admin/analytics`: signups by role/day, listings by status, enquiries by district × category × event type, response rate, median time to first response, supply-gap table (enquiries ÷ approved vendors per district × category).
AC:
- Numbers match fixture expectations.
- A profile view is counted at most once per session per vendor.
- The page renders with empty data.

**P1-13 Enquiry monitor and blocked contacts.** List of recent enquiries with spam flags (same phone sending to more than 10 vendors in 1 h), block a phone or email.
AC:
- An enquiry from a blocked phone gets 403 with a generic message.
- Flags appear for the fixture spam burst.

**P1-14 Terms and content policy page** (`/terms`). Covers the content policy (no communal or caste discrimination, no contact details in reviews) and media consent.
AC: linked from signup, the upload consent checkbox and the footer.

### P2: Customer journey

**P2-1 Customer area shell and home** (`/my`). Customer login lands here.
AC:
- A customer with enquiries sees the next event, the latest replies and the shortlist.
- Customers with no data see an empty state with event-type chips.
- No vendor CTAs appear.

**P2-2 Enquiry form v2.** Event type, guests, district, venue type, budget band, slot, food preference, per-unit qty with min-qty warning, E.164 phones (+971 and others), preferred contact.
AC:
- A +971 number is accepted and stored normalised.
- A guest count below a caterer's min plates shows a warning but is allowed.
- A past date gets 400.
- Request snapshots are stored.

**P2-3 Guest enquiry tracking.** `guest_token` link shown after submit (and in the WhatsApp share text). `/enquiry/[token]`. On signup or login with a matching email, guest enquiries are linked (phone matching waits for OTP).
AC:
- The token page shows status and offers without login.
- A wrong token gets 404.
- After signing up with the same email, the enquiry appears in `/my/enquiries`.

**P2-4 Itemised quote offers.** Vendor offer builder, versions, totals in paise, GST only when the vendor has a GSTIN, validity and advance %; customer accept or decline; an expired offer can't be accepted.
AC:
- Sending v2 supersedes v1.
- Line amounts must sum to the subtotal (400 otherwise).
- Accepting sets the enquiry to `accepted` and notifies the vendor.
- A vendor without a GSTIN cannot add GST.

**P2-5 Enquiry thread and status machine.** Messages both ways; customer withdraw; vendor or customer mark booked; transitions validated server-side (e.g. no `booked` after `withdrawn`).
AC:
- Every invalid transition gets 409.
- Every valid one writes `quote_status_events`.
- Contact details in messages are masked while billing is on (flag tested).

**P2-6 Vendor availability calendar.** Block, slots, capacity, bulk range, auto-block on booked, warning when blocking a date with a pending lead.
AC:
- Blocking 14 Jan removes the vendor from search when the date filter is 14 Jan.
- Capacity 2 with 1 booked shows "limited".
- Marking a lead booked increments `capacity_used`.

**P2-7 Search v2.** Offering-level results, served-district matching, budget per unit, date filter, event-type filter, verified filter, ranking order.
AC:
- "Photography, Ernakulam" returns an event company's separately-sellable photography unit and never its package-only units.
- A Thrissur vendor serving Ernakulam appears.
- The budget filter compares like units (per-plate versus per-event tested).
- Results are stable and paginated.

**P2-8 Event-type browse.** Home chips and `/e/[slug]` pages with the category bundle and top vendors per category. `/c/[slug]` category landing pages.
AC:
- `/e/nikah` lists the bundle categories from `event_type_categories`.
- The pages have unique titles and meta descriptions.
- An unknown slug gets 404.

**P2-9 Shortlist and multi-vendor enquiry.** Shortlist with notes, guest localStorage merged on login, "send to selected" up to 5, maximum 15 per day per phone, per-vendor results.
AC:
- 6 selected vendors get 400.
- The 16th enquiry in a day gets 429.
- A batch with one unpublished vendor reports a partial success.

**P2-10 Compare view** (`/my/compare`, 2–4 vendors).
AC: shows price from per unit, rating, verified, years, response time and key attributes for a shared category.

**P2-11 Reviews v2.** Verified only when booked or accepted and the event date has passed; vendor public reply; "request a review" link from the lead.
AC:
- A review before the event date is unverified.
- A review after a booked event is verified.
- One reply per review.
- The reply appears publicly.

**P2-12 Profile contact and mobile bar.** WhatsApp click-to-chat with prefilled text (logged as a `vendor_events` row and an optional `whatsapp_click` lead); phone shown to logged-in users; sticky mobile bar.
AC:
- The `wa.me` link is generated with the E.164 number and a URL-encoded message.
- The click is counted.
- The bar does not cover content (has a safe-area inset).

**P2-13 In-app notifications.** Bell for vendors (new lead, admin decision) and customers (offer, message).
AC:
- Unread count accurate.
- Mark-all-read.
- Created inside the same transaction as the triggering event.

**P2-14 Vendor reviews and insights pages.** `/vendor/reviews` (reply) and `/vendor/insights` (views, clicks, enquiries, booked rate).
AC: numbers match `vendor_events` and quotes fixtures, with a zero state.

### P3: Later (after income, or when an external account is approved)

1. **P3-1 Production storage adapter** (R2 / S3-compatible, Supabase optional). **Required before the first production deploy.**
2. **P3-2 Billing** (`005_billing.sql`, plans, `/pricing`, `/vendor/billing`, Razorpay test mode, webhooks).
3. **P3-3 Lead unlock credits and contact masking.**
4. **P3-4 Featured placements** and `/admin/revenue`.
5. **P3-5 Email notifications** (free-tier provider) and password reset.
6. **P3-6 WhatsApp Business API templates.**
7. **P3-7 Phone OTP login** and verified-phone badge, plus claim-by-OTP for seeded listings.
8. **P3-8 Malayalam UI**, plus `name_ml` everywhere in the UI.
9. **P3-9 Calendar sync** (ICS export first, then Google).
10. **P3-10 Team members and staff logins** (lead-only access), plus ownership transfer.
11. **P3-11 Customer event boards**, sub-events and collaborators.
12. **P3-12 Corporate enquiry fields** (company, GSTIN, invoice).
13. **P3-13 Quantity slab pricing**, venue slot pricing tables, peak-date surcharges and rental inventory per date range.
14. **P3-14 Native video transcoding** (Cloudflare Stream / Mux), watermarking, Instagram import and the weekly broken-link check.
15. **P3-15 Complaints and disputes** tickets, plus refund automation (spec §5).
16. **P3-16 Admin 2FA**, moderator role and CSV export.
17. **P3-17 CMS content pages** and seasonal banners (Onam).
18. **P3-18 Muhurtham date helper** and AED/USD reference prices for NRI users.

---

## 9. Decisions for the owner to confirm later (defaults chosen now)

| # | Decision | Default adopted now |
|---|---|---|
| 1 | Workspace URLs | `/vendor`, `/my`, `/admin`; `/dashboard` redirects by role |
| 2 | New listings go live immediately? | **No.** Draft → pending → approved by an admin (target < 24 h). Existing vendors grandfathered as approved. |
| 3 | Re-review on edit | Only name, primary category, phone/WhatsApp changes (listing stays live with the new values; flagged for admin) |
| 4 | Selling a unit separately: same listing or a separate brand? | Same listing. Offering-level `sale_mode`, unit search cards. One listing per account stays. |
| 5 | Offering vocabulary | Seeded templates per category plus "Other". Custom names visible on the profile and in text search immediately; promotion suggested at ≥3 vendors |
| 6 | Category attributes storage | JSONB plus a per-template schema in the DB; GIN index; only `filterable` keys become filters |
| 7 | Sub-categories | No `parent_id` for now. Granularity lives in offering templates. |
| 8 | Video | Links for all plans; small MP4 (≤50 MB, ≤90 s) for Pro and above, behind `MEDIA_VIDEO_UPLOADS`; no transcoding |
| 9 | Media limits | Spec photo numbers (10/50/200); albums 2/10/∞; links 2/10/30; MP4 0/3/10; Pro for all while billing is off |
| 10 | Media moderation | Pre-moderation until the vendor is approved; post-moderation afterwards plus reports |
| 11 | Image processing | sharp, server-side, WebP variants, originals not kept, EXIF stripped; client pre-resize to 2560 px |
| 12 | Production storage | Cloudflare R2 through `S3Adapter` (free egress); local disk in dev |
| 13 | Price display | "From ₹X / unit" by default; "On request" only for packages, Event Management, Priest, Venue and custom décor |
| 14 | Documents mandatory? | None mandatory. A verified document plus admin action earns the "Verified business" badge. FSSAI is encouraged for catering and cakes. |
| 15 | GST | Optional GSTIN; GST lines on offers only when a GSTIN is present; Vela never computes tax for vendors |
| 16 | Quote binding? | No. Offers are estimates with validity and advance %; no payments through Vela yet |
| 17 | Vendor phone/WhatsApp public? | Yes while `BILLING_ENABLED=false` (clicks logged); masked with the unlock flow when billing turns on |
| 18 | Guest enquiries | Allowed with phone; tracking-token link; linked to an account by email now, by phone after OTP (P3) |
| 19 | Multi-vendor enquiry cap | 5 per send, 15 per day per phone |
| 20 | Verified review | Enquiry `accepted` or `booked` **and** event date passed; older reviews keep their current flag |
| 21 | One account, many roles | One role per account. A vendor can view `/my/enquiries` for enquiries they sent; no customer home. |
| 22 | Availability enforcement | Soft. Blocked dates hide the vendor only when a date filter is applied; enquiry on a blocked date warns but is allowed |
| 23 | Availability granularity | Full / morning / evening with capacity per slot (default 1) |
| 24 | Login method | Email + password now; phone mandatory for vendors (unverified); OTP in P3 (free-tools rule) |
| 25 | Migration numbering | `004_vendor_workspace.sql` now, `005_billing.sql` later; `vendors.status` becomes TEXT + CHECK |
| 26 | Admin roles | A single `admin` role, created only by CLI script; moderator role in P3 |
| 27 | Suspension | Hide listing, block login (session revoked), keep all data; customers see "vendor unavailable" on open enquiries |
| 28 | Analytics | Plain SQL on page load plus `vendor_events` raw rows; no third-party analytics |
| 29 | Catalogue money unit | Integer rupees for catalogue prices (as today); paise for offers and payments |
| 30 | Legacy `portfolio_items` | Copied into `media_assets` in 004; table kept read-only for one release, then dropped |

---

## 10. Appendix: persona journeys (condensed)

**Full-service event company (Thrissur Events & Weddings).**
1. Signs up as a vendor → wizard: Company, Event Management.
2. Ticks decor, stage, photography (bookable separately), sadhya catering (package only, partner), chenda melam (partner), anchoring and Other "Thalappoli team".
3. Sets prices per unit (sadhya ₹280/plate min 150) and builds "Hindu wedding basic" (mandapam + stage + 300 sadhya + photography, from ₹2.5L).
4. Serves Thrissur (free), Ernakulam (₹5,000) and Kasaragod (on request), then uploads logo, cover, 3 albums and a YouTube reel.
5. Submits; the admin approves within 24 h.
6. Lands on `/vendor`, sees a nikah lead (decor + photography, 500 guests, Malappuram) and sends an itemised offer. The customer accepts, the date auto-blocks, and the vendor later replies to the review.
7. Search for "Photography Kochi" shows the company's photography unit card.

**Independent wedding planner.** An individual in Event Management who lists planning and day-of coordination (package, from ₹50,000, partner fulfilment) across 3 districts. Their workspace stresses leads and the calendar.

**Candid photographer (solo + freelancers).**
- Individual, Photography + Videography.
- Offerings: Wedding candid + traditional ₹65,000/event (attributes: 2 photographers, 400 photos, 30-sheet album, delivery in 45 days), Pre-wedding shoot, and Drone (add-on ₹8,000).
- Albums per wedding with a consent tick, plus Instagram reels.
- Blocks muhurtham dates with capacity 2 (two teams).

**Bridal makeup and mehendi (Kozhikode).** Bridal HD ₹15,000/event, trial ₹2,500 add-on, family makeup ₹1,500/person, mylanchi bridal ₹4,000, guest mehendi ₹150/person. Morning and evening slots on nikah plus reception days. Women-only team attribute.

**Sound, lighting and DJ (Ernakulam).** DJ ₹25,000/event (4 h) plus extra hour ₹4,000/hour, line array, LED wall ₹/sq ft/day, generator. Short MP4 clips of setups.

**Chenda melam troupe leader (Palakkad).** WhatsApp-first and not comfortable in English. Simple wizard: Traditional & Live Arts, Chenda melam (15 artists, 2 h, costume), price per event plus travel note, YouTube link. Admin help via the claim flow if he was seeded. Malayalam and OTP later.

**Sadhya caterer (Thrissur).** Catering offerings: Sadhya 24 items ₹280/leaf (min 150), Biryani ₹220/plate (min 100), add-ons for payasam and serving staff, max 1,500 guests/day, 2 kitchen crews. A 450-guest non-veg Kottayam enquiry arrives with food preference and guest count, and gets an offer with travel added.

**Venue owner (Ernakulam).** Venue attributes (800 seated, 400 dining in 2 batches, AC, parking 150 cars), slot pricing (morning ₹65,000, evening ₹55,000, full day ₹1.1L), blocks offline-booked muhurtham dates and confirms within 24 h.

**Rental shop, decorator/florist, cake maker, invitations, transport, priest.**
- Rental lists items with qty owned (chairs ₹12/day, 800 owned).
- The decorator sells stage décor from ₹25,000 and car décor ₹3,500.
- The baker sells per kg in 0.5 steps with a 3-day lead time.
- Invitations are per piece with min 100.
- Transport lists vehicles per 8 h / 80 km.
- The priest lists ceremonies with dakshina "on request".

**Wedding customer (Hindu, Thrissur, 600 guests).**
1. Home → Hindu wedding → Thrissur → date.
2. Filtered results (served districts, free on date) → profiles with real galleries → shortlist 3 photographers.
3. One enquiry to 3 → offers compared in `/my/enquiries` → accept one, mark booked → verified review after the event.

**Muslim nikah family (Malappuram/Kozhikode).** Mylanchi, nikah and walima on different dates. Separate enquiries per date for now (boards and sub-events in P3), women-led filter for makeup and photography, non-veg biryani caterer with per-plate budget.

**Church wedding (Kottayam).** Enquires only an event company's photography unit (bookable separately). Reception venue plus non-veg catering.

**NRI family (Dubai).** +971 phone accepted, WhatsApp preferred, reviews offers on mobile. Collaborators and AED reference in P3.

**Small events (birthday, baptism, housewarming, Onam office, college fest).** Event-type chips → bundle → budget per unit (per plate for catering) → guest enquiry with phone and no password, using the tracking link → compare replies → mark booked → review prompt. Corporate GST fields in P3.

**Owner-admin (on a phone).**
1. Logs in → `/admin` Today.
2. Approves pending vendors (media approved with them), requests changes on a duplicate, hides a review containing a phone number, promotes "Kolkali" from the custom queue.
3. Each week, checks the supply-gap table to decide where to recruit vendors.
4. Every action is in the audit log.
