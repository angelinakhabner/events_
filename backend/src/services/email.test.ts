import { describe, it, expect } from 'vitest';
import { welcomeEmail } from './email.js';

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
