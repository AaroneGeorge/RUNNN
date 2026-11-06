/**
 * Sign-in codes by email. With RESEND_API_KEY set, mail goes out through Resend;
 * otherwise the code is printed to the server console so you can develop offline.
 */
const API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM = process.env.MAIL_FROM ?? 'RUNNN <noreply@example.org>';
const APP_NAME = process.env.APP_NAME ?? 'RUNNN';

export const mailConfigured = () => API_KEY !== '';

export async function sendSignInCode(email: string, code: string): Promise<void> {
  const subject = `${code} is your ${APP_NAME} sign-in code`;
  const text = [
    `Your ${APP_NAME} sign-in code is ${code}.`,
    '',
    'It works for 10 minutes. If you did not ask for it, ignore this email.',
  ].join('\n');

  if (!API_KEY) {
    if (process.env.MAIL_LOG !== 'off') console.log(`[mail] to=${email} code=${code}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`mail send failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
