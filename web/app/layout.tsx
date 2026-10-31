import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSession } from "@/lib/session";
import Header from "./header";
import Footer from "./footer";

const SITE_NAME = "Vela";
const SITE_DESCRIPTION =
  "Kerala's marketplace for weddings & events: find, compare and request quotes from local vendors.";
// Public base URL for canonical/OG/JSON-LD links. Set NEXT_PUBLIC_SITE_URL in production.
function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Vela — Plan your event",
    template: "%s · Vela",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Vela — Plan your event",
    description: SITE_DESCRIPTION,
    locale: "en_IN",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Vela — Plan your event",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) report real values on notched phones; the
  // header, footer and fixed bottom bars pad themselves with it.
  viewportFit: "cover",
  themeColor: "#0f6d52",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl()}/#organization`,
      name: SITE_NAME,
      url: siteUrl(),
      description: SITE_DESCRIPTION,
      areaServed: { "@type": "State", name: "Kerala" },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl()}/#website`,
      name: SITE_NAME,
      url: siteUrl(),
      publisher: { "@id": `${siteUrl()}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${siteUrl()}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans text-foreground bg-background">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        <Header session={session ? { name: session.name, role: session.role } : null} />
        <div id="content" tabIndex={-1} className="flex-1 flex flex-col">
          {children}
        </div>
        <Footer role={session?.role ?? null} />
      </body>
    </html>
  );
}
