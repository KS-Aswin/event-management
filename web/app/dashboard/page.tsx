import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LogoutButton from "./logout-button";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between px-7 py-4 border-b border-line">
        <span className="font-display text-xl font-semibold text-accent">
          Vel<span className="text-gold">a</span>
        </span>
        <LogoutButton />
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold">
          Welcome, {session.name.split(" ")[0]}
        </h1>
        <p className="text-ink-soft text-sm mt-1 mb-6">
          You&apos;re signed in as a{" "}
          <span className="font-medium text-accent">{session.role}</span>.
        </p>

        <div className="border border-line rounded-xl p-5 text-sm text-ink-soft">
          This is a placeholder — the real customer/vendor dashboard (from the
          front-end mockup) gets built next. For now this page exists to prove
          the signup → login → session → protected page loop actually works
          end to end against the real database.
        </div>
      </main>
    </div>
  );
}
