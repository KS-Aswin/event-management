import { getSession, destroySessionCookie, type SessionPayload } from "@/lib/session";
import { findUserById } from "@/lib/db";

/**
 * Like getSession(), but also checks that the user row still exists and takes
 * the name and role from the database (so a role change applies at once).
 * A cookie for a deleted user is cleared and treated as signed out, instead
 * of letting writes fail later with foreign-key errors.
 */
export async function getLiveSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user) {
    try {
      await destroySessionCookie();
    } catch {
      // Cookies can't be modified in some render contexts; ignore.
    }
    return null;
  }
  return { userId: user.id, name: user.name, role: user.role };
}
