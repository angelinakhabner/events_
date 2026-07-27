import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock('../config.js', () => ({
  env: { RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'hello@goin.app' },
}));

const { welcomeEmail, sendEmail } = await import('./email.js');

const msg = { to: 'ada@example.com', subject: 'Hi', html: '<p>Hi</p>' };

describe('sendEmail', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('returns the created email on success', async () => {
    send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    await expect(sendEmail(msg)).resolves.toEqual({ id: 'email-1' });
  });

  // Resend resolves 4xx as { data: null, error } rather than rejecting. Left
  // unchecked that reads as success, so the magic-link flow would claim it had
  // mailed a link the provider actually refused.
  it('throws when Resend reports an error instead of reporting success', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'You can only send testing emails to your own email address' },
    });
    await expect(sendEmail(msg)).rejects.toThrow(
      /ada@example\.com.*You can only send testing emails to your own email address/,
    );
  });
});

describe('welcomeEmail', () => {
  it('puts the raw name in the subject', () => {
    expect(welcomeEmail('Ada').subject).toBe('Welcome to Goin, Ada');
  });

  it('escapes HTML-special characters in the name (no injection in the body)', () => {
    const { html } = welcomeEmail('<script>alert(1)</script>&"\'');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;');
  });

  it('produces a non-empty html body', () => {
    expect(welcomeEmail('Ada').html).toContain('Goin is ready');
  });
});
