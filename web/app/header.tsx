"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { UserRole } from "@/lib/db";

export default function Header({
  session,
}: {
  session: { name: string; role: UserRole } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";
  const isSearch = pathname === "/search";

  return (
    <header
      className={`flex items-center justify-between gap-4 px-7 py-3.5 sticky top-0 bg-white z-20 ${
        isHome ? "" : "border-b border-line"
      }`}
    >
      <div className="flex items-center gap-2 min-w-[34px]">
        {!isHome && (
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {!isHome && (
          <Link href="/" className="font-display text-xl font-semibold text-accent whitespace-nowrap">
            Vel<span className="text-gold">a</span>
          </Link>
        )}
      </div>

      {isSearch && <HeaderSearchBox />}

      {session ? (
        <nav className="flex items-center gap-5 text-sm whitespace-nowrap">
          <Link href="/dashboard" className="text-ink-soft hover:underline">
            Hi, {session.name.split(" ")[0]}
          </Link>
          <LogoutLink />
        </nav>
      ) : (
        <nav className="flex items-center gap-5 text-sm whitespace-nowrap">
          <Link href="/for-vendors" className="hover:underline">
            List your business
          </Link>
          <Link href="/for-vendors" className="hover:underline">
            For vendors
          </Link>
          <Link
            href="/login"
            className="bg-accent hover:bg-accent-hover text-white px-4.5 py-2 rounded-md font-medium"
          >
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}

function HeaderSearchBox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("q", value);
    else params.delete("q");
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form
      onSubmit={submit}
      className="hidden md:flex items-center gap-2.5 flex-1 max-w-[480px] border border-line rounded-full px-4 py-2"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-soft shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search vendors, categories, locations"
        className="flex-1 outline-none text-sm"
      />
    </form>
  );
}

function LogoutLink() {
  const router = useRouter();
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button onClick={handleLogout} className="hover:underline text-ink-soft">
      Logout
    </button>
  );
}
