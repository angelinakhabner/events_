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

export async function sendEmail(msg: EmailMessage) {
  return client().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  });
}

export function welcomeEmail(name: string): Omit<EmailMessage, 'to'> {
  return {
    subject: `Welcome to Goin, ${name}`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Goin is ready — start building folders of venues you actually care about.</p>`,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
