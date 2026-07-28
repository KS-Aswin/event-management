// Seeds the vendors and vendor_reviews tables with the same sample data
// used in /demo, so both versions of the app show consistent vendors.
// Safe to re-run: clears and re-inserts rather than duplicating.
//
// Run with: node db/seed.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const vendors = [
  { name: "Backwater Grand Palace", category: "Venue", location: "Kochi", price: 300000, priceLabel: "₹3,00,000 onwards", rating: 4.8, reviewsCount: 142, experience: "12 yrs", tags: ["Banquet Hall", "AC", "1000+ capacity"], about: "A full-service banquet hall on the Kochi backwaters, hosting weddings and receptions for up to 1,200 guests with in-house catering and decor partners." },
  { name: "Studio Frames by Arun", category: "Photography", location: "Kochi", price: 45000, priceLabel: "₹45,000 onwards", rating: 4.9, reviewsCount: 98, experience: "8 yrs", tags: ["Candid", "Drone", "Cinematic"], about: "Candid wedding photography and cinematic films, with drone coverage and same-week previews. Shot 300+ Kerala weddings since 2018." },
  { name: "Malabar Spice Caterers", category: "Catering", location: "Kozhikode", price: 600, priceLabel: "₹600 per plate", rating: 4.7, reviewsCount: 210, experience: "15 yrs", tags: ["Sadya", "North Indian", "Live Counters"], about: "Traditional Kerala sadya and multi-cuisine catering for weddings and functions, with live counters and custom menu planning." },
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

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("BEGIN");

  // Idempotent: wipe and re-insert rather than trying to upsert-match by name.
  await client.query("DELETE FROM vendor_reviews");
  await client.query("DELETE FROM quote_requests");
  await client.query("DELETE FROM vendors");
  await client.query("ALTER SEQUENCE vendors_id_seq RESTART WITH 1");

  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i];
    const result = await client.query(
      `INSERT INTO vendors (name, category, location, price, price_label, rating, reviews_count, experience, tags, about)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [v.name, v.category, v.location, v.price, v.priceLabel, v.rating, v.reviewsCount, v.experience, v.tags, v.about]
    );
    const vendorId = result.rows[0].id;
    const reviews = reviewsByVendorIndex[i] ?? [];
    for (const r of reviews) {
      await client.query(
        `INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1,$2,$3,$4)`,
        [vendorId, r.name, r.rating, r.body]
      );
    }
  }

  await client.query("COMMIT");
  console.log(`✓ Seeded ${vendors.length} vendors with reviews.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("✗ Seed failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
