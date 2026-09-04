import { describe, it, expect } from 'vitest';
import {
  ACCESS_HEADING,
  CONTACT_EMAIL,
  DESCRIPTION,
  META_DESCRIPTION,
  NAME,
  POLICY_SECTIONS,
} from './content';
import { LANDING_CSS, escapeHtml, landingBody, landingHead, prose, slug } from './render';

/**
 * The landing page is the only thing on this site a stranger or a crawler is
 * meant to read, and it is assembled by string concatenation rather than by
 * React. These are the assertions that keep it honest: that everything the
 * page promised to carry is in the served markup, that a crawler is told what
 * it is, and that prose cannot become markup.
 */

const body = landingBody();
const head = landingHead().join('\n');

describe('landing page markup', () => {
  it('names the product', () => {
    expect(body).toContain(NAME);
  });

  it('carries the description in full, not a teaser', () => {
    expect(body).toContain(escapeHtml(DESCRIPTION));
  });

  it('says how to get in, visibly', () => {
    expect(body).toContain(ACCESS_HEADING);
    expect(body).toMatch(/open to anyone/i);
    expect(body).toMatch(/no invitation to wait for/i);
  });

  it('gives a contact address that can be clicked', () => {
    expect(body).toContain(`mailto:${CONTACT_EMAIL}`);
  });

  it('carries the whole privacy policy, section by section', () => {
    expect(POLICY_SECTIONS.length).toBeGreaterThan(0);
    for (const section of POLICY_SECTIONS) {
      expect(body).toContain(section.heading);
      expect(body).toContain(`id="privacy-${slug(section.heading)}"`);
    }
  });

  it('reads as a document: one h1, and the sections under it', () => {
    expect(body.match(/<h1/g)).toHaveLength(1);
    for (const id of ['what-it-is', 'access', 'contact', 'privacy']) {
      expect(body).toContain(`id="${id}"`);
    }
  });

  // The policy states that this page loads nothing from anywhere else, which
  // is only true while it stays true.
  it('fetches nothing from a third party', () => {
    expect(body).not.toMatch(/https?:\/\//);
    expect(LANDING_CSS).not.toMatch(/https?:\/\/|@import|url\(/);
  });
});

describe('landing page head', () => {
  it('gives a crawler a title, a description and a canonical URL', () => {
    expect(head).toContain(`<title>${NAME}`);
    expect(head).toContain(`content="${META_DESCRIPTION}"`);
    expect(head).toContain('rel="canonical" href="https://afisz.cc/"');
  });

  it('asks to be indexed', () => {
    expect(head).toContain('content="index, follow"');
  });

  it('marks the dev preview noindex instead', () => {
    const dev = landingHead({ noindex: true }).join('\n');
    expect(dev).toContain('content="noindex, nofollow"');
    expect(dev).not.toContain('content="index, follow"');
  });

  it('describes itself in structured data', () => {
    expect(head).toContain('application/ld+json');
    const json = /<script type="application\/ld\+json">(.*)<\/script>/s.exec(head)?.[1];
    expect(JSON.parse(json!)).toMatchObject({ '@type': 'WebSite', name: NAME });
  });
});

describe('prose', () => {
  it('escapes anything that could be markup', () => {
    expect(prose('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('turns the {email} placeholder into a mailto link', () => {
    expect(prose('write to {email}.')).toBe(
      `write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.`,
    );
  });
});

describe('slug', () => {
  it('makes a heading linkable', () => {
    expect(slug('Who else sees it')).toBe('who-else-sees-it');
    expect(slug('What is never collected')).toBe('what-is-never-collected');
  });
});
