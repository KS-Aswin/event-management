"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ReasonDialog, { sendAdmin } from "./reason-dialog";

type Action = "suspend" | "unsuspend" | "force_logout";

const COPY: Record<Action, { title: string; confirm: string; done: string; required: boolean; danger: boolean }> = {
  suspend: {
    title: "Suspend this account?",
    confirm: "Suspend account",
    done: "Account suspended. Their sessions have ended.",
    required: true,
    danger: true,
  },
  unsuspend: {
    title: "Reinstate this account?",
    confirm: "Reinstate account",
    done: "Account reinstated.",
    required: false,
    danger: false,
  },
  force_logout: {
    title: "Sign this user out everywhere?",
    confirm: "Sign out everywhere",
    done: "Signed out on every device.",
    required: false,
    danger: false,
  },
};

export default function UserActions({
  userId,
  name,
  status,
  isSelf,
  hasListing,
}: {
  userId: number;
  name: string;
  status: string;
  isSelf: boolean;
  hasListing: boolean;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (isSelf) {
    return <p className="text-body text-ink-soft">This is your account. Another admin has to suspend or sign it out.</p>;
  }
  if (status === "deleted") {
    return <p className="text-body text-ink-soft">This account was deleted.</p>;
  }

  const descriptions: Record<Action, React.ReactNode> = {
    suspend: (
      <>
        {name} is signed out at once and can&apos;t sign in.
        {hasListing ? " Their listing is hidden from customers until the account is reinstated." : ""}
      </>
    ),
    unsuspend: (
      <>
        {name} can sign in again.
        {hasListing ? " Their listing goes back to the status it had, unless it was changed since." : ""}
      </>
    ),
    force_logout: <>{name} is signed out on every device and has to sign in again. Nothing else changes.</>,
  };

  async function confirm(reason: string) {
    if (!action) return null;
    const err = await sendAdmin(`/api/admin/users/${userId}`, "PATCH", { action, reason: reason || undefined });
    if (err) return err;
    setDone(COPY[action].done);
    setAction(null);
    router.refresh();
    return null;
  }

  const c = action ? COPY[action] : null;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "suspended" ? (
          <button type="button" className="btn btn-primary" onClick={() => setAction("unsuspend")}>
            Reinstate account
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary text-danger border-danger/40 hover:bg-danger-tint"
            onClick={() => setAction("suspend")}
          >
            Suspend account
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => setAction("force_logout")}>
          Sign out everywhere
        </button>
      </div>
      <p role="status" className={done ? "alert-success mt-3" : "sr-only"}>
        {done ?? ""}
      </p>
      <ReasonDialog
        open={action !== null}
        title={c?.title ?? ""}
        description={action ? descriptions[action] : null}
        confirmLabel={c?.confirm ?? ""}
        reasonRequired={c?.required ?? false}
        reasonHint={
          action === "suspend" ? "Saved in the audit log and shown to the user in their notifications." : "Saved in the audit log."
        }
        danger={c?.danger}
        onConfirm={confirm}
        onClose={() => setAction(null)}
      />
    </div>
  );
}
