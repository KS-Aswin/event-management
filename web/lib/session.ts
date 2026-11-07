import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { UserRole } from "./db";

const COOKIE_NAME = "vela_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  // Reject missing/short secrets and the placeholders shipped in templates, so
  // nobody runs with a publicly known signing key.
  if (!secret || secret.length < 32 || /your_|change_?me|placeholder/i.test(secret)) {
    throw new Error(
      "SESSION_SECRET is not set, too short (min 32 chars) or still a placeholder. " +
        "Set a long random string in .env.local (e.g. `openssl rand -base64 48`)."
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: number;
  name: string;
  role: UserRole;
  /** users.session_version when the cookie was issued (migration 004); bumping it logs the user out. */
  sessionVersion?: number;
}

export async function createSessionCookie(payload: SessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    // Unique per sign-in: two sign-ins in the same second would otherwise get
    // the same token, and logging one out (QA-081) would revoke both.
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  return (await getSessionWithToken())?.session ?? null;
}

/**
 * The verified session plus its raw token and expiry (unix seconds), for
 * the revocation check and logout (QA-081). Null when signed out.
 */
export async function getSessionWithToken(): Promise<{ session: SessionPayload; token: string; exp: number | null } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return {
      token,
      exp: typeof payload.exp === "number" ? payload.exp : null,
      session: {
        userId: payload.userId as number,
        name: payload.name as string,
        role: payload.role as UserRole,
        sessionVersion: typeof payload.sessionVersion === "number" ? payload.sessionVersion : undefined,
      },
    };
  } catch {
    // Expired or tampered token — treat as logged out rather than throwing,
    // so a stale cookie doesn't crash pages that check the session.
    return null;
  }
}

export async function destroySessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
