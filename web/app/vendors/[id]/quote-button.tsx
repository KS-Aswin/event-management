"use client";

import { useState } from "react";

export default function QuoteButton({ vendorId, vendorName }: { vendorId: number; vendorName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await fetch(`/api/vendors/${vendorId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          phone: formData.get("phone"),
          eventDate: formData.get("eventDate"),
          budget: formData.get("budget"),
          message: formData.get("message"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      setSuccess(true);
      form.reset();
      setLoading(false);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
      }, 1800);
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-5 py-2.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium"
      >
        Request quote
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-5" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-xl p-7 max-w-[420px] w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setOpen(false)} className="float-right text-xl text-ink-soft">
              &times;
            </button>
            <h3 className="text-[19px] font-semibold mb-1">Request a quote from {vendorName}</h3>
            <p className="text-ink-soft text-[13px] mb-4.5">Vendor usually replies within a few hours</p>

            {success ? (
              <div className="text-sm text-accent bg-accent-tint rounded-md px-3.5 py-3">
                Quote request sent — the vendor will reply soon.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3.5">
                {error && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}
                <FormField label="Your name" name="name" required />
                <FormField label="Phone number" name="phone" type="tel" required />
                <FormField label="Event date" name="eventDate" type="date" required />
                <FormField label="Budget (₹)" name="budget" placeholder="e.g. 1,50,000" />
                <div>
                  <label className="block text-[13px] text-ink-soft mb-1.5">Message</label>
                  <textarea
                    name="message"
                    rows={3}
                    placeholder="Tell them about your event..."
                    className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
                  />
                </div>
                <div className="flex gap-2.5 mt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-70"
                  >
                    {loading ? "Sending…" : "Send request"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function FormField({
  label,
  name,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[13px] text-ink-soft mb-1.5">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 border border-line rounded-md text-sm outline-none focus:border-accent"
      />
    </div>
  );
}
