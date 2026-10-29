// Seeds sample vendors, reviews and services (Kerala) using the same vendors
// as /demo, so both versions of the app show consistent data.
// Safe to re-run: clears and re-inserts rather than duplicating.
// Requires migrations first: npm run db:migrate
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

// Per-vendor profile fields and services (see migration 002).
const vendorExtras = {
  "Backwater Grand Palace": {
    "district": "Ernakulam",
    "vendorType": "company",
    "services": [
      {
        "category": "Venue",
        "title": "Banquet hall (up to 1,200 guests)",
        "description": "Full hall with AC, stage and parking.",
        "priceFrom": 300000,
        "priceUnit": "event"
      },
      {
        "category": "Decoration",
        "title": "Stage and entrance decoration",
        "description": "In-house decor partners for the hall.",
        "priceFrom": 80000,
        "priceUnit": "event"
      },
      {
        "category": "Catering",
        "title": "In-house catering",
        "description": "Veg and non-veg menus, sadya on request.",
        "priceFrom": 600,
        "priceUnit": "plate"
      }
    ]
  },
  "Studio Frames by Arun": {
    "district": "Ernakulam",
    "vendorType": "individual",
    "services": [
      {
        "category": "Photography",
        "title": "Wedding photography",
        "description": "Candid photography for the full wedding day.",
        "priceFrom": 45000,
        "priceUnit": "event"
      },
      {
        "category": "Videography",
        "title": "Cinematic wedding film",
        "description": "Highlight film with drone shots.",
        "priceFrom": 35000,
        "priceUnit": "event"
      }
    ]
  },
  "Malabar Spice Caterers": {
    "district": "Kozhikode",
    "vendorType": "company",
    "services": [
      {
        "category": "Catering",
        "title": "Traditional sadya",
        "description": "Banana-leaf sadya with live counters.",
        "priceFrom": 600,
        "priceUnit": "plate"
      },
      {
        "category": "Catering",
        "title": "North Indian and multi-cuisine buffet",
        "description": "Custom menu planning included.",
        "priceFrom": 750,
        "priceUnit": "plate"
      }
    ]
  },
  "Petal & Palm Decor": {
    "district": "Thrissur",
    "vendorType": "company",
    "services": [
      {
        "category": "Decoration",
        "title": "Floral mandap",
        "description": "Themed floral mandap and entrance arch.",
        "priceFrom": 80000,
        "priceUnit": "event"
      },
      {
        "category": "Decoration",
        "title": "Stage with LED backdrop",
        "description": "Stage design with LED wall.",
        "priceFrom": 60000,
        "priceUnit": "event"
      }
    ]
  },
  "DJ Rhythm Kerala": {
    "district": "Ernakulam",
    "vendorType": "company",
    "services": [
      {
        "category": "DJ & Music",
        "title": "DJ and sound system",
        "description": "Full sound system with lighting.",
        "priceFrom": 25000,
        "priceUnit": "event"
      },
      {
        "category": "DJ & Music",
        "title": "Live band",
        "description": "Live band for sangeet and receptions.",
        "priceFrom": 60000,
        "priceUnit": "event"
      }
    ]
  },
  "Glow Bridal Studio": {
    "district": "Kottayam",
    "vendorType": "individual",
    "services": [
      {
        "category": "Makeup",
        "title": "Bridal makeup and hairstyling",
        "description": "HD and airbrush, trial session included.",
        "priceFrom": 15000,
        "priceUnit": "event"
      }
    ]
  },
  "Henna Dreams": {
    "district": "Kozhikode",
    "vendorType": "individual",
    "services": [
      {
        "category": "Mehendi",
        "title": "Bridal mehendi",
        "description": "Arabic, traditional Kerala and Indo-Arabic designs.",
        "priceFrom": 8000,
        "priceUnit": "event"
      },
      {
        "category": "Mehendi",
        "title": "Guest mehendi",
        "description": "Per-person designs for guests.",
        "priceFrom": 300,
        "priceUnit": "person"
      }
    ]
  },
  "Grand Vista Convention Centre": {
    "district": "Thiruvananthapuram",
    "vendorType": "company",
    "services": [
      {
        "category": "Venue",
        "title": "Indoor hall and outdoor lawn",
        "description": "Indoor and outdoor venue with valet parking.",
        "priceFrom": 250000,
        "priceUnit": "event"
      }
    ]
  },
  "Momentz Cinematics": {
    "district": "Thrissur",
    "vendorType": "company",
    "services": [
      {
        "category": "Photography",
        "title": "Wedding photography",
        "description": "Candid and traditional photography.",
        "priceFrom": 55000,
        "priceUnit": "event"
      },
      {
        "category": "Videography",
        "title": "Cinematic wedding film with same-day edit",
        "description": "Same-day edit shown at the reception.",
        "priceFrom": 65000,
        "priceUnit": "event"
      }
    ]
  }
};

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
  await client.query("DELETE FROM vendors"); // services and portfolio cascade
  await client.query("ALTER SEQUENCE vendors_id_seq RESTART WITH 1");

  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i];
    const extra = vendorExtras[v.name];
    const result = await client.query(
      `INSERT INTO vendors (name, category, location, price, price_label, rating, reviews_count, experience, tags, about, vendor_type, district_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               (SELECT id FROM districts WHERE state = 'Kerala' AND name = $12))
       RETURNING id`,
      [v.name, v.category, v.location, v.price, v.priceLabel, v.rating, v.reviewsCount, v.experience, v.tags, v.about, extra.vendorType, extra.district]
    );
    const vendorId = result.rows[0].id;
    for (let j = 0; j < extra.services.length; j++) {
      const sv = extra.services[j];
      await client.query(
        `INSERT INTO services (vendor_id, category_id, title, description, price_from, price_unit, sort_order)
         VALUES ($1, (SELECT id FROM categories WHERE name = $2), $3, $4, $5, $6, $7)`,
        [vendorId, sv.category, sv.title, sv.description, sv.priceFrom, sv.priceUnit, j]
      );
    }
    const reviews = reviewsByVendorIndex[i] ?? [];
    for (const r of reviews) {
      await client.query(
        `INSERT INTO vendor_reviews (vendor_id, reviewer_name, rating, body) VALUES ($1,$2,$3,$4)`,
        [vendorId, r.name, r.rating, r.body]
      );
    }
  }

  await client.query("COMMIT");
  console.log(`✓ Seeded ${vendors.length} vendors with reviews and services.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("✗ Seed failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
