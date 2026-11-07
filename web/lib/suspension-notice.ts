import { jwtVerify, SignJWT } from "jose";

// QA-056: short-lived signed note "user N was signed out because they are
// suspended". Whatever clears a suspended user's session (proxy.ts on
// /login, or resolveLiveSession when an API call or page guard finds the
// account suspended) sets it, so /login?suspended=1 can still look the
// reason up live from the DB after the session cookie is gone. HttpOnly and
// signed, so it can't be forged or read by scripts; it holds only the user
// id, never the reason. Only jose here: proxy.ts and route handlers share it.

export const NOTICE_COOKIE = "vela_suspended";
const NOTICE_AUDIENCE = "vela-suspension-notice";
export const NOTICE_TTL_S = 10 * 60;

/**
 * Cookie options for the note. Path "/" (not just /login): after an API call
 * cleared the session, the next guarded page (/vendor/...) has no session,
 * and proxy.ts uses the note to send the user to /login?suspended=1 instead
 * of a plain sign-in form.
 */
export const NOTICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: NOTICE_TTL_S,
};

function noticeKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
}

export async function signSuspensionNotice(userId: number): Promise<string | null> {
  const key = noticeKey();
  if (!key || !Number.isInteger(userId)) return null;
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(NOTICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${NOTICE_TTL_S}s`)
    .sign(key);
}

/** The user id in a valid note, else null. */
export async function suspensionNoticeUserId(token: string | undefined): Promise<number | null> {
  const key = noticeKey();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { audience: NOTICE_AUDIENCE });
    return Number.isInteger(payload.uid) ? (payload.uid as number) : null;
  } catch {
    return null;
  }
}
