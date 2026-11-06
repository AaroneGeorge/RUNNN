// Sign-in codes by email. With RESEND_API_KEY set, codes are emailed through Resend (MAIL_FROM sets the sender;
// Resend's onboarding@resend.dev works for testing to your own address). Without it, the code is printed to the
// server console so sign-in can be tested locally.

export type Delivery = 'email' | 'console';

export async function sendLoginCode(email: string, code: string): Promise<Delivery> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[sign-in] code for ${email}: ${code}  (set RESEND_API_KEY to email it instead)`);
    return 'console';
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'Zombie Run <onboarding@resend.dev>',
      to: [email],
      subject: `${code} is your Zombie Run code`,
      text: `Your Zombie Run sign-in code is ${code}.\n\nIt works for 10 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Your Zombie Run sign-in code is</p><p style="font:900 32px/1 system-ui;letter-spacing:6px">${code}</p><p>It works for 10 minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Could not send the email (${res.status})`);
  return 'email';
}
