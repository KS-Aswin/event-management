"use client";

import { useState } from "react";
import Link from "next/link";

interface AdminVendor {
  id: number;
  name: string;
  category: string;
  location: string;
  verified: boolean;
  featured: boolean;
  published: boolean;
}

type Flag = "verified" | "featured" | "published";

export default function AdminVendors({ initialVendors }: { initialVendors: AdminVendor[] }) {
  const [vendors, setVendors] = useState<AdminVendor[]>(initialVendors);
  const [error, setError] = useState<string | null>(null);

  async function toggle(vendor: AdminVendor, flag: Flag) {
    setError(null);
    const next = !vendor[flag];
    const res = await fetch(`/api/admin/vendors/${vendor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [flag]: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setVendors((prev) => prev.map((v) => (v.id === vendor.id ? { ...v, [flag]: next } : v)));
  }

  return (
    <div className="border border-line rounded-xl overflow-hidden">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border-b border-red-100 px-4 py-2">{error}</div>
      )}
      {vendors.map((v, i) => (
        <div
          key={v.id}
          className={`flex items-center justify-between gap-3 px-4 py-3 text-sm flex-wrap ${
            i < vendors.length - 1 ? "border-b border-line" : ""
          }`}
        >
          <div className="min-w-0">
            <Link href={`/vendors/${v.id}`} className="font-medium hover:underline">
              {v.name}
            </Link>
            <div className="text-xs text-ink-soft">
              {v.category} · {v.location}
            </div>
          </div>
          <div className="flex gap-2">
            {(["verified", "featured", "published"] as Flag[]).map((flag) => (
              <button
                key={flag}
                onClick={() => toggle(v, flag)}
                className={`text-xs rounded-full px-3 py-1 border ${
                  v[flag]
                    ? "bg-accent-tint border-accent text-accent font-medium"
                    : "border-line text-ink-soft hover:border-accent"
                }`}
              >
                {flag}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
