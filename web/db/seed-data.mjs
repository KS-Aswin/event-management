// Sample data for db/seed.mjs (Kerala). The first 9 vendors match /demo and
// the API test suite (tests/api.test.mjs counts them by name), so keep their
// names, categories, locations, ratings and tags as they are.
//
// Six of them are the P0-16 archetypes with full workspaces (offerings from
// the taxonomy, package-only units, a package, add-ons, albums, cover, logo):
//   event company   Kerala Celebrations Co.
//   photographer    Studio Frames by Arun
//   caterer         Malabar Spice Caterers
//   venue           Backwater Grand Palace
//   chenda troupe   Guruvayur Chenda Sangham
//   rental          Thrissur Tent & Rentals
//
// Offering fields: template (offering_templates.code, null for "Other"),
// category (categories.name), title, description, price, unit, mode
// ('from' | 'fixed' | 'range' | 'on_request'), saleMode ('separate' |
// 'package_only'), fulfilment, unitLabel, minQty, inclusions, addons[]
// (same fields, attached to this unit), key (to reference it from a package).

export const vendors = [
  {
    name: "Backwater Grand Palace", category: "Venue", location: "Kochi", district: "Ernakulam", vendorType: "company",
    price: 300000, priceLabel: "₹3,00,000 onwards", rating: 4.8, reviewsCount: 142, experience: "12 yrs", years: 12,
    tags: ["Banquet Hall", "AC", "1000+ capacity"], maxGuests: 1200, team: 40,
    about: "A full-service banquet hall on the Kochi backwaters, hosting weddings and receptions for up to 1,200 guests with in-house catering and decor partners.",
    areas: [["Ernakulam", null, null]],
    theme: { from: "#0f4c5c", to: "#5fa8a0", accent: "#f2c14e", motif: "venue" },
    archetype: true,
    offerings: [
      { key: "hall", template: "banquet-hall", category: "Venue", title: "Banquet hall (up to 1,200 guests)", description: "Full AC hall with stage, green rooms and parking for 300 cars. Price is per slot (morning or evening).", price: 300000, unit: "slot", inclusions: ["Stage", "Green rooms", "Parking", "Power backup"],
        addons: [{ template: null, category: "Venue", title: "Extra hour", description: "Extend your slot by one hour.", price: 15000, unit: "hour" }] },
      { key: "lawn", template: "outdoor-lawn", category: "Venue", title: "Backwater lawn (up to 500 guests)", description: "Open lawn on the water for receptions and sangeet nights.", price: 150000, unit: "slot" },
      { key: "decor", template: "stage-mandapam-decor", category: "Decoration", title: "Stage and entrance decoration", description: "In-house decor partners for the hall.", price: 80000, unit: "event", fulfilment: "partner" },
      { key: "food", template: "kerala-sadhya", category: "Catering", title: "In-house catering", description: "Veg and non-veg menus, sadya on request.", price: 600, unit: "plate", minQty: 200 },
    ],
    packages: [{ title: "Hall + decor + sadya for 500", description: "Banquet hall for one slot, stage decor and a sadya for 500 guests.", price: 680000, items: [["hall", 1], ["decor", 1], ["food", 500]] }],
    gallery: [
      { title: "The banquet hall", subtitle: "Set for a 900-guest reception" },
      { title: "Backwater lawn", subtitle: "Sunset reception setup" },
      { title: "Stage at night", subtitle: "Floral mandap by our decor partners" },
      { title: "Dining hall", subtitle: "Sadya seating for 400" },
    ],
    album: { title: "Weddings in 2025", caption: "Recent weddings at the hall" },
  },
  {
    name: "Studio Frames by Arun", category: "Photography", location: "Kochi", district: "Ernakulam", vendorType: "individual",
    price: 45000, priceLabel: "₹45,000 onwards", rating: 4.9, reviewsCount: 98, experience: "8 yrs", years: 8,
    tags: ["Candid", "Drone", "Cinematic"], team: 4, extraCategories: ["Videography"],
    about: "Candid wedding photography and cinematic films, with drone coverage and same-week previews. Shot 300+ Kerala weddings since 2018.",
    areas: [["Ernakulam", null, null], ["Thrissur", 2000, "Travel charged at actuals"], ["Kottayam", 2000, null], ["Alappuzha", 1500, null]],
    theme: { from: "#2b2d42", to: "#8d99ae", accent: "#ef8354", motif: "camera" },
    archetype: true,
    videoLink: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    offerings: [
      { key: "photo", template: "wedding-photography", category: "Photography", title: "Wedding photography", description: "Candid and traditional photography for the full wedding day, two photographers.", price: 45000, unit: "event", inclusions: ["2 photographers", "400+ edited photos", "Online gallery"],
        addons: [
          { template: "drone-coverage", category: "Photography", title: "Drone coverage", description: "Aerial shots of the venue and procession.", price: 8000, unit: "event" },
          { template: "album-printing", category: "Photography", title: "Printed album (40 pages)", description: "Lay-flat premium album.", price: 12000, unit: "item" },
        ] },
      { key: "prewed", template: "pre-wedding-shoot", category: "Photography", title: "Pre-wedding shoot", description: "Half-day shoot at a location of your choice in Kerala.", price: 20000, unit: "session" },
      { key: "film", template: "cinematic-film", category: "Videography", title: "Cinematic wedding film", description: "5-minute highlight film with drone shots.", price: 35000, unit: "event" },
    ],
    packages: [{ title: "Wedding photo + film", description: "Full-day photography and a cinematic highlight film.", price: 72000, items: [["photo", 1], ["film", 1]] }],
    gallery: [
      { title: "Golden hour portrait", subtitle: "Fort Kochi, 2025" },
      { title: "The thali moment", subtitle: "Guruvayur temple wedding" },
      { title: "Reception candids", subtitle: "Bolgatty Palace" },
      { title: "Drone over the backwaters", subtitle: "Kumarakom" },
    ],
    album: { title: "Meera & Rahul", caption: "Temple wedding, Guruvayur" },
  },
  {
    name: "Malabar Spice Caterers", category: "Catering", location: "Kozhikode", district: "Kozhikode", vendorType: "company",
    price: 600, priceLabel: "₹600 per plate", rating: 4.7, reviewsCount: 210, experience: "15 yrs", years: 15,
    tags: ["Sadya", "North Indian", "Live Counters"], team: 60, maxGuests: 3000, fssai: "11223344556677",
    about: "Traditional Kerala sadya and multi-cuisine catering for weddings and functions, with live counters and custom menu planning.",
    areas: [["Kozhikode", null, null], ["Malappuram", 3000, null], ["Kannur", 5000, "For 300+ guests only"]],
    theme: { from: "#7f2704", to: "#e3a857", accent: "#ffd166", motif: "food" },
    archetype: true,
    offerings: [
      { key: "sadya", template: "kerala-sadhya", category: "Catering", title: "Traditional sadya", description: "26-item banana-leaf sadya with two payasams.", price: 600, unit: "plate", minQty: 100, inclusions: ["Banana leaf", "2 payasams", "Serving staff"],
        addons: [{ template: "serving-staff", category: "Catering", title: "Extra serving staff", description: "Uniformed staff for buffet or table service.", price: 900, unit: "person" }] },
      { key: "biryani", template: "malabar-biryani", category: "Catering", title: "Malabar biryani feast", description: "Kozhikode dum biryani with starters and dessert.", price: 450, unit: "plate", minQty: 100 },
      { key: "buffet", template: "north-indian-buffet", category: "Catering", title: "North Indian and multi-cuisine buffet", description: "Custom menu planning included.", price: 750, unit: "plate", minQty: 150 },
      { key: "live", template: "live-counters", category: "Catering", title: "Live counters", description: "Dosa, appam and chaat counters, only with a full menu.", price: 15000, unit: "item", saleMode: "package_only" },
    ],
    packages: [{ title: "Wedding feast for 300", description: "Sadya for 300 guests plus two live counters.", price: 210000, items: [["sadya", 300], ["live", 2]] }],
    gallery: [
      { title: "Onam sadya", subtitle: "26 items on a banana leaf" },
      { title: "Malabar biryani", subtitle: "Dum-cooked on site" },
      { title: "Live appam counter", subtitle: "Reception, Kozhikode" },
    ],
    album: { title: "Sadya service", caption: "Sadya for 800 guests" },
  },
  {
    name: "Petal & Palm Decor", category: "Decoration", location: "Thrissur", district: "Thrissur", vendorType: "company",
    price: 80000, priceLabel: "₹80,000 onwards", rating: 4.6, reviewsCount: 76, experience: "6 yrs", years: 6,
    tags: ["Floral", "Stage", "LED Wall"],
    about: "Floral and stage decor studio specialising in themed mandaps, LED backdrops, and entrance arches.",
    areas: [["Thrissur", null, null], ["Palakkad", 4000, null]],
    theme: { from: "#6a0572", to: "#f7a1c4", accent: "#ffe066", motif: "flower" },
    offerings: [
      { template: "stage-mandapam-decor", category: "Decoration", title: "Floral mandap", description: "Themed floral mandap and entrance arch.", price: 80000, unit: "event" },
      { template: "led-backdrop", category: "Decoration", asUnit: true, title: "Stage with LED backdrop", description: "Stage design with LED wall.", price: 60000, unit: "event" },
    ],
    gallery: [{ title: "Floral mandap", subtitle: "Marigold and jasmine" }, { title: "Entrance arch", subtitle: "Thrissur, 2025" }],
  },
  {
    name: "DJ Rhythm Kerala", category: "DJ & Music", location: "Ernakulam", district: "Ernakulam", vendorType: "company",
    price: 25000, priceLabel: "₹25,000 onwards", rating: 4.5, reviewsCount: 54, experience: "5 yrs", years: 5,
    tags: ["Live Band", "Sound System", "Lighting"],
    about: "DJ and live band services for weddings and sangeet nights, with full sound and stage lighting setup.",
    areas: [["Ernakulam", null, null]],
    theme: { from: "#10002b", to: "#7b2cbf", accent: "#48cae4", motif: "sparkle" },
    offerings: [
      { template: "dj", category: "DJ & Music", title: "DJ and sound system", description: "Full sound system with lighting.", price: 25000, unit: "event" },
      { template: "live-band", category: "DJ & Music", title: "Live band", description: "Live band for sangeet and receptions.", price: 60000, unit: "event" },
    ],
    gallery: [{ title: "Sangeet night", subtitle: "Full lighting rig" }, { title: "Reception DJ", subtitle: "Kochi" }],
  },
  {
    name: "Glow Bridal Studio", category: "Makeup", location: "Kottayam", district: "Kottayam", vendorType: "individual",
    price: 15000, priceLabel: "₹15,000 onwards", rating: 4.9, reviewsCount: 189, experience: "10 yrs", years: 10,
    tags: ["Bridal", "HD Makeup", "Hairstyling"],
    about: "Bridal makeup and hairstyling artists trained in HD and airbrush techniques, with trial sessions included.",
    areas: [["Kottayam", null, null], ["Pathanamthitta", 1500, null]],
    theme: { from: "#9d4edd", to: "#ffb5a7", accent: "#fff3b0", motif: "sparkle" },
    offerings: [{ template: "bridal-makeup-hd", category: "Makeup", title: "Bridal makeup and hairstyling", description: "HD and airbrush, trial session included.", price: 15000, unit: "event" }],
    gallery: [{ title: "Bridal look", subtitle: "HD makeup" }, { title: "Hairstyling", subtitle: "Jasmine bun" }],
  },
  {
    name: "Henna Dreams", category: "Mehendi", location: "Kozhikode", district: "Kozhikode", vendorType: "individual",
    price: 8000, priceLabel: "₹8,000 onwards", rating: 4.7, reviewsCount: 63, experience: "7 yrs", years: 7,
    tags: ["Bridal Mehendi", "Arabic", "Traditional"],
    about: "Bridal and guest mehendi artists offering Arabic, traditional Kerala, and Indo-Arabic designs.",
    areas: [["Kozhikode", null, null]],
    theme: { from: "#5a3e1b", to: "#c98b48", accent: "#f4e3c1", motif: "flower" },
    offerings: [
      { template: "bridal-mehendi", category: "Mehendi", title: "Bridal mehendi", description: "Arabic, traditional Kerala and Indo-Arabic designs.", price: 8000, unit: "event" },
      { template: "guest-mehendi", category: "Mehendi", title: "Guest mehendi", description: "Per-person designs for guests.", price: 300, unit: "person" },
    ],
    gallery: [{ title: "Bridal mehendi", subtitle: "Indo-Arabic" }, { title: "Mylanchi night", subtitle: "Kozhikode" }],
  },
  {
    name: "Grand Vista Convention Centre", category: "Venue", location: "Thiruvananthapuram", district: "Thiruvananthapuram", vendorType: "company",
    price: 250000, priceLabel: "₹2,50,000 onwards", rating: 4.4, reviewsCount: 88, experience: "9 yrs", years: 9,
    tags: ["Indoor", "Outdoor Lawn", "Valet"], maxGuests: 1500,
    about: "Indoor and outdoor lawn venue with valet parking, suited for weddings, receptions and corporate events.",
    areas: [["Thiruvananthapuram", null, null]],
    theme: { from: "#1d3557", to: "#a8dadc", accent: "#e63946", motif: "venue" },
    offerings: [{ template: "auditorium", category: "Venue", title: "Indoor hall and outdoor lawn", description: "Indoor and outdoor venue with valet parking.", price: 250000, unit: "slot" }],
    gallery: [{ title: "Convention hall", subtitle: "1,500 seats" }, { title: "Outdoor lawn", subtitle: "Evening reception" }],
  },
  {
    name: "Momentz Cinematics", category: "Photography", location: "Thrissur", district: "Thrissur", vendorType: "company",
    price: 55000, priceLabel: "₹55,000 onwards", rating: 4.8, reviewsCount: 120, experience: "9 yrs", years: 9,
    tags: ["Cinematic", "Same Day Edit"], extraCategories: ["Videography"],
    about: "Cinematic wedding films with same-day edits and drone coverage, working across Kerala and South India.",
    areas: [["Thrissur", null, null], ["Ernakulam", 2500, null]],
    theme: { from: "#283618", to: "#a3b18a", accent: "#fefae0", motif: "camera" },
    offerings: [
      { template: "wedding-photography", category: "Photography", title: "Wedding photography", description: "Candid and traditional photography.", price: 55000, unit: "event" },
      { template: "cinematic-film", category: "Videography", title: "Cinematic wedding film with same-day edit", description: "Same-day edit shown at the reception.", price: 65000, unit: "event" },
    ],
    gallery: [{ title: "Same-day edit", subtitle: "Shown at the reception" }, { title: "Church wedding", subtitle: "Thrissur" }],
  },
  // ---- P0-16 archetypes that are not in /demo --------------------------------
  {
    name: "Kerala Celebrations Co.", category: "Event Management", location: "Kochi", district: "Ernakulam", vendorType: "company",
    rating: 4.7, reviewsCount: 41, experience: "11 yrs", years: 11, legalName: "Kerala Celebrations Private Limited",
    tags: ["Full Planning", "Destination Weddings", "Corporate"], team: 25, maxGuests: 2000, perDay: 2,
    extraCategories: ["Photography", "Decoration"],
    about: "End-to-end wedding and event planners in Kochi. One team for decor, photography, hospitality and the day itself, with partners we have worked with for years.",
    areas: [["Ernakulam", null, null], ["Thrissur", 5000, null], ["Alappuzha", 5000, null], ["Idukki", 10000, "Munnar and Vagamon destination weddings"]],
    travelOutside: true,
    theme: { from: "#7b2d26", to: "#f4a259", accent: "#fde4cf", motif: "sparkle" },
    archetype: true,
    offerings: [
      { key: "plan", template: "full-planning", category: "Event Management", title: "Full wedding planning", description: "From the first venue visit to the send-off: budget, vendors, timeline and a team on the day.", price: 150000, unit: "package", inclusions: ["Budget and vendor plan", "3 site visits", "Day-of team of 6"] },
      { key: "dayof", template: "day-of-coordination", category: "Event Management", title: "Day-of coordination", description: "A coordinator and assistants run the day so your family can enjoy it.", price: 25000, unit: "event",
        addons: [{ template: null, category: "Event Management", title: "Extra coordinator", description: "One more coordinator for large weddings.", price: 6000, unit: "person" }] },
      { key: "theme", template: "theme-design", category: "Event Management", title: "Theme and decor design", description: "Mood board, colour story and decor plan, delivered with our decor partners. Only as part of a package.", price: 40000, unit: "event", saleMode: "package_only" },
      { key: "photo", template: "wedding-photography", category: "Photography", title: "Wedding photography (partner team)", description: "Our partner photographers cover the full day.", price: 40000, unit: "event", fulfilment: "partner", saleMode: "package_only" },
      { key: "guests", template: "guest-hospitality", category: "Event Management", title: "Guest hospitality desk", description: "Welcome desk, room allocation and travel help for out-station guests.", price: 30000, unit: "event" },
    ],
    packages: [{ title: "Signature wedding package", description: "Theme design, partner photography and day-of coordination in one booking.", price: 95000, items: [["theme", 1], ["photo", 1], ["dayof", 1]] }],
    gallery: [
      { title: "Mandap by the lake", subtitle: "Destination wedding, Kumarakom" },
      { title: "Welcome desk", subtitle: "Guest hospitality" },
      { title: "Corporate gala", subtitle: "Lulu Bolgatty, 2025" },
      { title: "Haldi setup", subtitle: "Theme design" },
    ],
    album: { title: "Destination weddings", caption: "Munnar and Kumarakom" },
  },
  {
    name: "Guruvayur Chenda Sangham", category: "Traditional & Live Arts", location: "Guruvayur", district: "Thrissur", vendorType: "company",
    rating: 4.9, reviewsCount: 37, experience: "22 yrs", years: 22,
    tags: ["Chenda Melam", "Panchavadyam", "Temple Festivals"], team: 18, perDay: 2,
    about: "A 15-member chenda troupe from Guruvayur playing melam, panchavadyam and thayambaka for weddings, temple festivals and corporate welcomes.",
    areas: [["Thrissur", null, null], ["Palakkad", 3000, null], ["Malappuram", 3000, null], ["Ernakulam", 4000, null]],
    theme: { from: "#9b2226", to: "#ee9b00", accent: "#ffe8a1", motif: "drum" },
    archetype: true,
    offerings: [
      { key: "melam", template: "chenda-melam", category: "Traditional & Live Arts", title: "Chenda melam (15 artists)", description: "Shinkari melam for the groom's arrival or a procession, about 45 minutes.", price: 18000, unit: "event", unitLabel: "15 artists, 45 min",
        addons: [{ template: null, category: "Traditional & Live Arts", title: "Extra 30 minutes", description: "Keep the melam going for another half hour.", price: 5000, unit: "hour" }] },
      { key: "pancha", template: "panchavadyam", category: "Traditional & Live Arts", title: "Panchavadyam", description: "Timila, maddalam, ilathalam, idakka and kombu, for temple festivals and grand entries.", price: 30000, unit: "event" },
      { key: "thayambaka", template: "thayambaka", category: "Traditional & Live Arts", title: "Thayambaka solo", description: "A lead chenda artist with accompaniment, for evening stage programmes.", price: 12000, unit: "event" },
    ],
    gallery: [
      { title: "Shinkari melam", subtitle: "Groom's arrival, Thrissur" },
      { title: "Panchavadyam", subtitle: "Temple festival" },
      { title: "Thayambaka", subtitle: "Evening programme" },
    ],
    album: { title: "Festival season", caption: "Pooram and temple festivals" },
  },
  {
    name: "Thrissur Tent & Rentals", category: "Rental", location: "Thrissur", district: "Thrissur", vendorType: "company",
    rating: 4.5, reviewsCount: 52, experience: "18 yrs", years: 18,
    tags: ["Pandal", "Chairs & Tables", "Generator"], team: 30,
    about: "Pandals, shamianas, chairs, tables, coolers and generators for weddings and functions, set up and taken down by our own crew.",
    areas: [["Thrissur", null, null], ["Palakkad", 2500, null], ["Ernakulam", 3500, "Transport charged per truck"]],
    theme: { from: "#264653", to: "#2a9d8f", accent: "#e9c46a", motif: "tent" },
    archetype: true,
    offerings: [
      { key: "pandal", template: "pandal-shamiana", category: "Rental", title: "Pandal / shamiana", description: "Waterproof pandal with side curtains and lighting, set up a day before.", price: 18, unit: "sqft", minQty: 1000 },
      { key: "chairs", template: "chairs", category: "Rental", title: "Chairs with covers", description: "Cushioned chairs with white or ivory covers.", price: 15, unit: "item", unitLabel: "chair", minQty: 50 },
      { key: "tables", template: "tables", category: "Rental", title: "Round tables", description: "Round tables for 8 with cloth.", price: 120, unit: "item", minQty: 10 },
      { key: "cooler", template: "tower-ac-cooler", category: "Rental", title: "Tower AC / air cooler", description: "Tower AC units for pandals and halls.", price: 1800, unit: "item" },
      { key: "gen", template: "generator", category: "Rental", title: "Silent generator (62.5 kVA)", description: "With operator and diesel for 8 hours.", price: 6500, unit: "day" },
    ],
    packages: [{ title: "Pandal for 300 guests", description: "2,500 sq ft pandal, 300 chairs, 38 tables and 4 coolers.", price: 64000, items: [["pandal", 2500], ["chairs", 300], ["tables", 38], ["cooler", 4]] }],
    gallery: [
      { title: "Wedding pandal", subtitle: "3,000 sq ft, Thrissur" },
      { title: "Chairs and tables", subtitle: "Ivory covers" },
      { title: "Night setup", subtitle: "With generator backup" },
    ],
  },
];

export const reviewsByVendor = {
  "Backwater Grand Palace": [{ name: "Anjali R.", rating: 5, body: "Beautiful venue, staff coordinated everything smoothly on the day." }, { name: "Vishnu K.", rating: 5, body: "Spacious hall, parking was never an issue even with 800 guests." }],
  "Studio Frames by Arun": [{ name: "Meera S.", rating: 5, body: "Arun captured moments we didn't even know were happening. Loved the drone shots." }, { name: "Rahul P.", rating: 4, body: "Great photos, delivery took a little longer than promised." }],
  "Malabar Spice Caterers": [{ name: "Devika N.", rating: 5, body: "The sadya was authentic and the live counters were a huge hit with guests." }],
  "Petal & Palm Decor": [{ name: "Sona T.", rating: 4, body: "Loved the floral mandap design, exactly what we asked for." }],
  "DJ Rhythm Kerala": [{ name: "Arjun M.", rating: 5, body: "Great song selection, kept the dance floor full all night." }],
  "Glow Bridal Studio": [{ name: "Nithya V.", rating: 5, body: "The trial session helped a lot, bridal look was perfect." }],
  "Henna Dreams": [{ name: "Fathima A.", rating: 5, body: "Intricate designs, finished quickly even with 20 guests waiting." }],
  "Grand Vista Convention Centre": [{ name: "Kiran J.", rating: 4, body: "Nice outdoor lawn option, would have liked more shaded seating." }],
  "Momentz Cinematics": [{ name: "Anu B.", rating: 5, body: "The same-day edit at the reception made everyone emotional." }],
  "Kerala Celebrations Co.": [{ name: "Liya & Tom", rating: 5, body: "They handled our Munnar wedding end to end. We just turned up." }],
  "Guruvayur Chenda Sangham": [{ name: "Sreeraj M.", rating: 5, body: "The melam for the groom's arrival gave everyone goosebumps." }],
  "Thrissur Tent & Rentals": [{ name: "Joseph K.", rating: 4, body: "Pandal was up on time and stayed dry through the rain." }],
};

export const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const initials = (name) =>
  name.replace(/&/g, " ").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(by|and|of|the|co\.?)$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

/** The media each vendor gets: logo, cover and gallery photos (file names in db/fixtures/media). */
export function mediaPlan(v) {
  const slug = slugify(v.name);
  const t = v.theme;
  const items = [
    { file: `${slug}-logo.jpg`, purpose: "logo", ...t, title: initials(v.name), caption: "", alt: `${v.name} logo` },
    { file: `${slug}-cover.jpg`, purpose: "cover", ...t, title: v.name, subtitle: `${v.category} · ${v.location}`, caption: "", alt: `${v.name} cover photo` },
  ];
  v.gallery.forEach((g, i) => {
    // Alternate the gradient direction so a gallery doesn't look like one image repeated.
    const swap = i % 2 === 1;
    items.push({
      file: `${slug}-${i + 1}.jpg`, purpose: "gallery", motif: t.motif, accent: t.accent,
      from: swap ? t.to : t.from, to: swap ? t.from : t.to,
      title: g.title, subtitle: g.subtitle, caption: `${g.title} - ${g.subtitle}`, alt: `${g.title}, ${g.subtitle} (sample image)`,
    });
  });
  return items;
}

export function fixtureSpecs() {
  return vendors.flatMap(mediaPlan);
}
