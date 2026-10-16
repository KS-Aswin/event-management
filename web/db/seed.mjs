// Seeds the vendors and vendor_reviews tables with the same sample data
// used in /demo, so both versions of the app show consistent vendors.
// Safe to re-run: it replaces only the sample vendors (the ones with no owner
// account), so real vendors, users and leads are never touched.
//
// Refuses to run when NODE_ENV=production unless SEED_FORCE=1, so it can't be
// run against a live database by accident.
//
// Run with: node db/seed.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
  console.error("Refusing to seed with NODE_ENV=production. Set SEED_FORCE=1 if you really mean it.");
  process.exit(1);
}

const vendors = [
  { name: "Backwater Grand Palace", category: "Venue", location: "Kochi", price: 300000, priceLabel: "₹3,00,000 onwards", rating: 4.8, reviewsCount: 142, experience: "12 yrs", tags: ["Banquet Hall", "AC", "1000+ capacity"], about: "A full-service banquet hall on the Kochi backwaters, hosting weddings and receptions for up to 1,200 guests with in-house catering and decor partners." },
  { name: "Studio Frames by Arun", category: "Photography", location: "Kochi", price: 45000, priceLabel: "₹45,000 onwards", rating: 4.9, reviewsCount: 98, experience: "8 yrs", tags: ["Candid", "Drone", "Cinematic"], about: "Candid wedding photography and cinematic films, with drone coverage and same-week previews. Shot 300+ Kerala weddings since 2018." },
  { name: "Malabar Spice Caterers", category: "Catering", location: "Kozhikode", price: 600, priceLabel: "₹600 per plate", priceUnit: "per plate", rating: 4.7, reviewsCount: 210, experience: "15 yrs", tags: ["Sadya", "North Indian", "Live Counters"], about: "Traditional Kerala sadya and multi-cuisine catering for weddings and functions, with live counters and custom menu planning." },
  { name: "Petal & Palm Decor", category: "Decoration", location: "Thrissur", price: 80000, priceLabel: "₹80,000 onwards", rating: 4.6, reviewsCount: 76, experience: "6 yrs", tags: ["Floral", "Stage", "LED Wall"], about: "Floral and stage decor studio specialising in themed mandaps, LED backdrops, and entrance arches." },
  { name: "DJ Rhythm Kerala", category: "DJ & Music", location: "Ernakulam", price: 25000, priceLabel: "₹25,000 onwards", rating: 4.5, reviewsCount: 54, experience: "5 yrs", tags: ["Live Band", "Sound System", "Lighting"], about: "DJ and live band services for weddings and sangeet nights, with full sound and stage lighting setup." },
  { name: "Glow Bridal Studio", category: "Makeup", location: "Kottayam", price: 15000, priceLabel: "₹15,000 onwards", rating: 4.9, reviewsCount: 189, experience: "10 yrs", tags: ["Bridal", "HD Makeup", "Hairstyling"], about: "Bridal makeup and hairstyling artists trained in HD and airbrush techniques, with trial sessions included." },
  { name: "Henna Dreams", category: "Mehendi", location: "Kozhikode", price: 8000, priceLabel: "₹8,000 onwards", rating: 4.7, reviewsCount: 63, experience: "7 yrs", tags: ["Bridal Mehendi", "Arabic", "Traditional"], about: "Bridal and guest mehendi artists offering Arabic, traditional Kerala, and Indo-Arabic designs." },
  { name: "Grand Vista Convention Centre", category: "Venue", location: "Thiruvananthapuram", price: 250000, priceLabel: "₹2,50,000 onwards", rating: 4.4, reviewsCount: 88, experience: "9 yrs", tags: ["Indoor", "Outdoor Lawn", "Valet"], about: "Indoor and outdoor lawn venue with valet parking, suited for weddings, receptions and corporate events." },
  { name: "Momentz Cinematics", category: "Photography", location: "Thrissur", price: 55000, priceLabel: "₹55,000 onwards", rating: 4.8, reviewsCount: 120, experience: "9 yrs", tags: ["Cinematic", "Same Day Edit"], about: "Cinematic wedding films with same-day edits and drone coverage, working across Kerala and South India." },
];

const reviewsByVendorIndex = {
  0: [{ name: "Anjali R.", rating: 5, body: "Beautiful venue, staff coordinated everything smoothly on the day." }, { name: "Vishnu K.", rating: 5, body: "Spacious hall, parking was never an issue even with 800 guests." }],
  1: [{ name: "Meera S.", rating: 5, body: "Arun captured moments we didn't even know were happening. Loved the drone shots." }, { name: "Rahul P.", rating: 4, body: "Great photos, delivery took a little longer than promised." }],
  2: [{ name: "Devika N.", rating: 5, body: "The sadya was authentic and the live counters were a huge hit with guests." }],
  3: [{ name: "Sona T.", rating: 4, body: "Loved the floral mandap design, exactly what we asked for." }],
  4: [{ name: "Arjun M.", rating: 5, body: "Great song selection, kept the dance floor full all night." }],
  5: [{ name: "Nithya V.", rating: 5, body: "The trial session helped a lot, bridal look was perfect." }],
  6: [{ name: "Fathima A.", rating: 5, body: "Intricate designs, finished quickly even with 20 guests waiting." }],
  7: [{ name: "Kiran J.", rating: 4, body: "Nice outdoor lawn option, would have liked more shaded seating." }],
  8: [{ name: "Anu B.", rating: 5, body: "The same-day edit at the reception made everyone emotional." }],
};

// Which sample vendors are admin-verified / featured, to demo those features.
const VERIFIED_INDEXES = new Set([0, 1, 2, 5, 8]);
const FEATURED_INDEXES = new Set([1, 5]);

// Sample packages. Real vendors create their own from the dashboard.
function samplePackages(v) {
  const unit = v.priceUnit ?? "onwards";
  const round = (n) => Math.round(n / 100) * 100;
  return [
    { name: "Basic", price: v.price, items: ["Standard service", "Up to 4 hours", "Digital delivery"] },
    { name: "Standard", price: round(v.price * 1.6), items: ["Extended coverage", "Priority support", "Extra add-ons"] },
    { name: "Premium", price: round(v.price * 2.4), items: ["Full-day service", "Dedicated coordinator", "All add-ons included"] },
  ].map((p) => ({ ...p, unit }));
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("BEGIN");

  // Replace only the ownerless sample vendors (cascades to their reviews,
  // packages, quotes and views). Vendors created by real accounts stay.
  await client.query("DELETE FROM vendors WHERE owner_id IS NULL");
  // Restart ids at 1 only when the table is empty, so the sample vendors get
  // ids 1-9 on a fresh database (the test suite relies on that).
  const remaining = await client.query("SELECT COUNT(*)::int AS n FROM vendors");
  if (remaining.rows[0].n === 0) {
    await client.query("ALTER SEQUENCE vendors_id_seq RESTART WITH 1");
  }

  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i];
    const result = await client.query(
      `INSERT INTO vendors (name, category, location, price, price_label, price_unit, rating, reviews_count, experience, tags, about, verified, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        v.name, v.category, v.location, v.price, v.priceLabel, v.priceUnit ?? "onwards",
        v.rating, v.reviewsCount, v.experience, v.tags, v.about,
        VERIFIED_INDEXES.has(i), FEATURED_INDEXES.has(i),
      ]
    );
    const vendorId = result.rows[0].id;
    for (const r of reviewsByVendorIndex[i] ?? []) {
      await client.query(
        `INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1,$2,$3,$4)`,
        [vendorId, r.name, r.rating, r.body]
      );
    }
    for (const p of samplePackages(v)) {
      await client.query(
        `INSERT INTO vendor_packages (vendor_id, name, price, items) VALUES ($1,$2,$3,$4)`,
        [vendorId, p.name, p.price, p.items]
      );
    }
  }

  await client.query("COMMIT");
  console.log(`✓ Seeded ${vendors.length} sample vendors with reviews and packages.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("✗ Seed failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
