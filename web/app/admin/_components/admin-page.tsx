import Link from "next/link";

// Shared building blocks for admin pages, so every queue looks the same.
// Each page renders exactly one <main> (the shell wraps it in a plain div).

/** Page frame: eyebrow, title, optional description and actions, then content. */
export function AdminPage({
  title,
  eyebrow = "Admin",
  description,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <main className="w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="font-display text-heading sm:text-display font-semibold tracking-tight mt-1">{title}</h1>
          {description && <p className="text-ink-soft text-body mt-1.5 max-w-prose">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="mt-6">{children}</div>
    </main>
  );
}

/** Empty state for a queue or list (also used by the placeholders). */
export function AdminEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="card max-w-xl">
      <h2 className="text-title font-semibold">{title}</h2>
      {body && <p className="text-body text-ink-soft mt-1">{body}</p>}
      {action && (
        <Link href={action.href} className="btn btn-secondary mt-4">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Placeholder until a feature agent replaces the page. */
export function ComingSoon({ title, what }: { title: string; what: string }) {
  return (
    <AdminPage title={title}>
      <AdminEmptyState
        title="Coming soon"
        body={`${what} will appear here.`}
        action={{ href: "/admin", label: "Back to Today" }}
      />
    </AdminPage>
  );
}
