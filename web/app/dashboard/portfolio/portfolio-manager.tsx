"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  id: number;
  url: string;
  caption: string | null;
}

export default function PortfolioManager({
  vendorId,
  initialItems,
  uploadsEnabled,
}: {
  vendorId: number;
  initialItems: Item[];
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveItem(imageUrl: string, imageCaption: string) {
    const res = await fetch(`/api/vendors/${vendorId}/portfolio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, caption: imageCaption || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    setItems((prev) => [data.item, ...prev]);
    router.refresh();
  }

  async function addByUrl(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await saveItem(url, caption);
      setUrl("");
      setCaption("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
    setBusy(false);
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
      if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller.");

      const signRes = await fetch("/api/uploads/sign", { method: "POST" });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error ?? "Uploads aren't available right now.");

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sign.apiKey);
      form.append("timestamp", String(sign.timestamp));
      form.append("folder", sign.folder);
      form.append("signature", sign.signature);
      const upRes = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, {
        method: "POST",
        body: form,
      });
      const uploaded = await upRes.json();
      if (!upRes.ok || !uploaded.secure_url) throw new Error("The upload failed. Please try again.");

      await saveItem(uploaded.secure_url, caption);
      setCaption("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
    setBusy(false);
    e.target.value = "";
  }

  async function remove(id: number) {
    const res = await fetch(`/api/vendors/${vendorId}/portfolio/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-line rounded-xl p-5.5 space-y-3">
        <h3 className="text-[15px] font-semibold">Add a photo</h3>
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={120}
          placeholder="Caption (optional)"
          className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
        />
        {uploadsEnabled && (
          <div>
            <label className="block text-[13px] text-ink-soft mb-1.5">Upload from your device</label>
            <input type="file" accept="image/*" onChange={uploadFile} disabled={busy} className="text-sm" />
          </div>
        )}
        <form onSubmit={addByUrl} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="…or paste an https image link"
            className="flex-1 px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-70"
          >
            Add
          </button>
        </form>
        {!uploadsEnabled && (
          <p className="text-xs text-ink-soft">
            File upload isn&apos;t switched on for this site yet, so paste a link to an image you host.
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((it) => (
            <div key={it.id} className="border border-line rounded-lg overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.caption ?? "Portfolio photo"} className="w-full h-[130px] object-cover" />
              <div className="p-2 flex items-center justify-between gap-2">
                <span className="text-xs text-ink-soft truncate">{it.caption ?? ""}</span>
                <button onClick={() => remove(it.id)} className="text-xs text-red-700 hover:underline shrink-0">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
