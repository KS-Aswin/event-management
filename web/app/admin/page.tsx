import type { Metadata } from "next";
import Link from "next/link";
import { AdminPage } from "./_components/admin-page";
import { getTodaySummary, type TodayTile } from "@/lib/admin/ops";
import { ago, fmtDateTime } from "./users/_components/ui";

export const metadata: Metadata = { title: "Today" };

// P1-4 Today inbox: every queue's count and its oldest waiting item, plus
// a few activity numbers. One round of aggregate queries (getTodaySummary).
export default async function AdminHomePage() {
  const { tiles, generatedAt } = await getTodaySummary();
  const queues = tiles.filter((t) => t.queue);
  const activity = tiles.filter((t) => !t.queue);
  const waiting = queues.reduce((s, t) => s + t.count, 0);

  return (
    <AdminPage
      title="Today"
      description={
        waiting === 0
          ? "All queues are clear."
          : `${waiting.toLocaleString("en-IN")} ${waiting === 1 ? "item is" : "items are"} waiting. Start with the oldest.`
      }
      actions={
        <Link href="/admin" className="btn btn-secondary" prefetch={false}>
          Refresh
        </Link>
      }
    >
      <section aria-labelledby="queues-h">
        <h2 id="queues-h" className="eyebrow">
          Needs action
        </h2>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="today-queues">
          {queues.map((t) => (
            <Tile key={t.key} tile={t} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="activity-h" className="mt-8">
        <h2 id="activity-h" className="eyebrow">
          Activity
        </h2>
        <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="today-activity">
          {activity.map((t) => (
            <Tile key={t.key} tile={t} />
          ))}
        </ul>
      </section>

      <p className="mt-6 text-caption text-ink-soft">Updated {fmtDateTime(generatedAt)}</p>
    </AdminPage>
  );
}

function Tile({ tile: t }: { tile: TodayTile }) {
  const hot = t.queue && t.count > 0;
  return (
    <li
      className={`card p-0 flex flex-col overflow-hidden ${hot ? "border-accent/40" : ""}`}
      data-tile={t.key}
      data-count={t.count}
    >
      <Link href={t.href} className="group flex-1 block px-4 pt-4 pb-3 min-h-11 hover:bg-surface-muted focus-visible:bg-surface-muted">
        <span className="flex items-start justify-between gap-3">
          <span className="text-body font-medium">{t.label}</span>
          <span aria-hidden="true" className="text-ink-soft group-hover:text-accent transition-colors">
            →
          </span>
        </span>
        <span className="mt-1 flex items-baseline gap-2">
          <span className={`font-display text-[30px] leading-tight font-semibold tabular-nums ${hot ? "text-accent" : ""}`}>
            {t.count.toLocaleString("en-IN")}
          </span>
          {t.note && <span className="text-caption text-ink-soft">{t.note}</span>}
        </span>
      </Link>
      <div className="border-t border-line px-4 py-2.5 text-caption text-ink-soft min-h-11 flex items-center">
        {t.item ? (
          <Link href={t.item.href} className="min-w-0 hover:text-foreground focus-visible:text-foreground">
            <span className="font-medium">{t.itemLabel}:</span>{" "}
            <span className="text-foreground">{t.item.label}</span>
            {t.item.sub ? <span className="break-words"> · {t.item.sub.replace(/_/g, " ").slice(0, 60)}</span> : null}
            <span> · {ago(t.item.at)}</span>
          </Link>
        ) : (
          <span>{t.queue ? "Nothing waiting" : "None yet"}</span>
        )}
      </div>
    </li>
  );
}
