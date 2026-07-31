import { Resend } from 'resend';
import { env } from '../config.js';

let _client: Resend | null = null;
function client(): Resend {
  if (!_client) {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    _client = new Resend(env.RESEND_API_KEY);
  }
  return _client;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send one transactional email, throwing when the provider refuses it.
 *
 * The Resend SDK does not reject on API errors — a 4xx resolves as
 * `{ data: null, error }`. Returning that unchecked made every failure look
 * like a success to callers: the magic-link flow would tell the user "we sent
 * a sign-in link" for a send Resend had rejected outright (unverified sending
 * domain, or the testing sender `onboarding@resend.dev`, which only delivers
 * to the Resend account's own address). Surfacing the provider message is what
 * makes those cases diagnosable.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const { data, error } = await client().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  });
  if (error) {
    throw new Error(`Resend rejected the email to ${msg.to}: ${error.message}`);
  }
  return data;
}

export function welcomeEmail(name: string): Omit<EmailMessage, 'to'> {
  return {
    subject: `Welcome to AFISZ, ${name}`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>AFISZ is ready — start building folders of venues you actually care about.</p>`,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
