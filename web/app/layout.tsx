import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/session";
import Header from "./header";

export const metadata: Metadata = {
  title: "Vela — Plan your event",
  description: "Kerala's marketplace for weddings & events",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <Header session={session ? { name: session.name, role: session.role } : null} />
        {children}
      </body>
    </html>
  );
}
