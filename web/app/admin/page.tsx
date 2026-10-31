import type { Metadata } from "next";
import { AdminPage, AdminEmptyState } from "./_components/admin-page";

export const metadata: Metadata = { title: "Today" };

// Placeholder until the P1-4 Today inbox ships (PRODUCT_PLAN 2.5).
export default function AdminHomePage() {
  return (
    <AdminPage
      title="Today"
      description="Queue counts and the oldest item in each queue: new vendors, reported reviews, media to check and custom offerings."
    >
      <AdminEmptyState
        title="Coming soon"
        body="The moderation queues will appear here. Use the menu to open a queue."
        action={{ href: "/admin/vendors", label: "Open vendors" }}
      />
    </AdminPage>
  );
}
