// Sends transactional email through Resend's HTTP API when RESEND_API_KEY is
// set. Without a key (local dev, tests) it just logs the message, so flows
// like password reset can still be exercised by reading the server log.
// Never throws: a failed email must not break the request that triggered it.

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export async function sendEmail(params: { to: string; subject: string; text: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email:dev] to=${params.to} subject="${params.subject}"\n${params.text}\n`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Vela <onboarding@resend.dev>",
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend responded ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("[email] failed to send:", err);
  }
}
