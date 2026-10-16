import { findUserById } from "./db";
import { getSession } from "./session";

// Admin checks read the role from the database rather than trusting the
// session cookie, so revoking admin rights takes effect immediately.
export async function requireAdmin(): Promise<{ userId: number } | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user || user.role !== "admin") return null;
  return { userId: user.id };
}
