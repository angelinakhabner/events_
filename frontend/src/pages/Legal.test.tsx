/**
 * GOI-95: /policy and /terms.
 *
 * These are legal documents, so the tests are about the obligations rather
 * than the prose: the clauses Polish law requires the regulamin to contain,
 * the disclosures RODO requires the notice to contain, and — the one with
 * teeth — that the app's rendering and the public landing page's cannot say
 * different things, because they are the same text.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PolicyPage } from './Policy';
import { TermsPage } from './Terms';
import {
  CONTACT_EMAIL, DPA, POLICY_SECTIONS, TERMS_SECTIONS, operatorIdentity,
} from '../landing/content';
import { escapeHtml, landingBody } from '../landing/render';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/policy" element={<PolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The whole rendered document as one string. */
function text(): string {
  return document.body.textContent ?? '';
}

/**
 * Every string of copy in a document, placeholders expanded the way both
 * renderers expand them, as a list of paragraphs and list items.
 */
function copyOf(sections: readonly { blocks: readonly unknown[] }[]): string[] {
  return sections
    .flatMap((s) => s.blocks as { kind: string; text?: string; items?: string[] }[])
    .flatMap((b) => (b.kind === 'p' ? [b.text ?? ''] : (b.items ?? [])))
    .map((line) => line.split('{email}').join(CONTACT_EMAIL));
}

/**
 * Whitespace out, for comparing copy against rendered `textContent`.
 *
 * The DOM runs adjacent block elements together — a paragraph ending in a
 * colon abuts the first `<li>` with no space between them — so a comparison
 * that respects whitespace fails on formatting rather than on wording, which
 * is not what this is checking.
 */
function squeeze(s: string): string {
  return s.replace(/\s+/g, '');
}

describe('privacy policy', () => {
  it('names a contact address for data requests', () => {
    renderAt('/policy');
    expect(screen.getAllByRole('link', { name: CONTACT_EMAIL })[0]!)
      .toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
  });

  it('leaves no {email} placeholder unexpanded', () => {
    renderAt('/policy');
    expect(text()).not.toContain('{email}');
  });

  it('identifies the controller', () => {
    renderAt('/policy');
    expect(text()).toContain(operatorIdentity());
    expect(text()).toMatch(/administrator danych osobowych/);
  });

  /** Art. 13(2)(d) RODO: the notice must name the supervisory authority the
   *  reader can complain to, and in Poland that is a specific office. */
  it('names the Polish supervisory authority and how to reach it', () => {
    renderAt('/policy');
    expect(text()).toContain(DPA.name);
    expect(text()).toContain(DPA.address);
  });

  it('states a legal basis for each purpose it describes', () => {
    renderAt('/policy');
    for (const basis of ['art. 6(1)(a)', 'art. 6(1)(b)', 'art. 6(1)(f)']) {
      expect(text()).toContain(basis);
    }
  });

  it('lists every data subject right, including withdrawal of consent', () => {
    renderAt('/policy');
    for (const right of [
      'art. 15', 'art. 16', 'art. 17', 'art. 18', 'art. 20', 'art. 21', 'art. 7(3)',
    ]) {
      expect(text()).toContain(right);
    }
  });

  it('names the processors that actually receive data', () => {
    renderAt('/policy');
    for (const processor of ['Railway', 'GitHub Pages', 'Resend', 'Google', 'Anthropic']) {
      expect(text()).toContain(processor);
    }
  });

  it('addresses transfers outside the EEA', () => {
    renderAt('/policy');
    expect(text()).toMatch(/Standard Contractual Clauses/i);
    expect(text()).toMatch(/Data Privacy Framework/i);
  });

  it('says how long each kind of data is kept', () => {
    renderAt('/policy');
    expect(text()).toMatch(/How long it is kept/i);
    expect(text()).toMatch(/single-use/i);
  });

  /** The claims that would be false if a tracker were ever added. They are
   *  asserted so that adding one without amending the copy breaks a test. */
  it('states plainly that there is no advertising, analytics or profiling', () => {
    renderAt('/policy');
    expect(text()).toMatch(/not sold, rented/i);
    expect(text()).toMatch(/no analytics package/i);
    expect(text()).toMatch(/art\. 22 GDPR/);
  });

  it('explains the browser storage it uses in place of a cookie banner', () => {
    renderAt('/policy');
    expect(text()).toMatch(/local storage/i);
    expect(text()).toMatch(/Prawo telekomunikacyjne/);
  });

  it('carries the date it was last changed', () => {
    renderAt('/policy');
    expect(screen.getByText(/^Last updated \d{1,2} \w+ \d{4}$/)).toBeInTheDocument();
  });

  it('links to the terms', () => {
    renderAt('/policy');
    expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute('href', '/terms');
  });
});

describe('terms of use', () => {
  /**
   * Art. 8(3) of the ustawa o świadczeniu usług drogą elektroniczną fixes the
   * minimum contents of a regulamin. One section each.
   */
  it('covers everything art. 8(3) UŚUDE requires of a regulamin', () => {
    renderAt('/terms');
    expect(text()).toMatch(/What the service does/i);            // scope
    expect(text()).toMatch(/What you need to use it/i);          // technical requirements
    expect(text()).toMatch(/must not supply unlawful content/i); // unlawful content
    expect(text()).toMatch(/Complaints/i);                       // complaints procedure
  });

  it('gives a complaints route and a deadline for answering', () => {
    renderAt('/terms');
    expect(text()).toMatch(/answered within 14 days/i);
  });

  it('states the consumer right of withdrawal rather than disclaiming it', () => {
    renderAt('/terms');
    expect(text()).toMatch(/withdraw from the contract within 14 days/i);
    expect(text()).toMatch(/ustawa o prawach konsumenta/);
  });

  /** The listings are scraped and can be wrong; saying so is the point of the
   *  clause, and "check with the venue" is the actionable half. */
  it('is honest about the accuracy of scraped listings', () => {
    renderAt('/terms');
    expect(text()).toMatch(/Check with the venue before you set out/i);
    expect(text()).toMatch(/not as a guarantee/i);
  });

  it('does not purport to exclude liability the law will not let it exclude', () => {
    renderAt('/terms');
    expect(text()).toMatch(/not excluded or limited for wilful misconduct/i);
    expect(text()).toMatch(/the law prevails/i);
  });

  it('says the newsletter is sent on consent that can be withdrawn', () => {
    renderAt('/terms');
    expect(text()).toMatch(/withdraw that consent at any time/i);
    expect(text()).toMatch(/unsubscribe link/i);
  });

  it('names the governing law', () => {
    renderAt('/terms');
    expect(text()).toMatch(/governed by Polish law/i);
  });

  it('links to the privacy policy', () => {
    renderAt('/terms');
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/policy');
  });
});

/**
 * The whole point of driving both surfaces from `landing/content.ts`.
 *
 * The policy is published twice — as static HTML a stranger can read without
 * JavaScript, and as this route for someone already in the app. Two copies of
 * a legal document are two documents, and they drift: the first draft of these
 * pages named a different contact address from the landing page's. Nothing but
 * a test stops that happening again.
 */
describe('the app and the landing page are one document', () => {
  it('renders every line of the policy, unaltered', () => {
    renderAt('/policy');
    const rendered = squeeze(text());
    for (const line of copyOf(POLICY_SECTIONS)) {
      expect(rendered).toContain(squeeze(line));
    }
  });

  it('renders every line of the terms, unaltered', () => {
    renderAt('/terms');
    const rendered = squeeze(text());
    for (const line of copyOf(TERMS_SECTIONS)) {
      expect(rendered).toContain(squeeze(line));
    }
  });

  // The other direction: the static page carries the same lines, so neither
  // surface can quietly gain or lose a clause.
  it('carries the same lines in the static page', () => {
    const html = squeeze(landingBody());
    for (const line of [...copyOf(POLICY_SECTIONS), ...copyOf(TERMS_SECTIONS)]) {
      // The static renderer escapes prose before inserting it, so compare
      // against the escaped form the browser will un-escape back to this.
      expect(html).toContain(squeeze(escapeHtml(line).split(escapeHtml(CONTACT_EMAIL)).join(
        `<ahref="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>`,
      )));
    }
  });

  // The static page is what a stranger — and a regulator — actually reads, so
  // it has to carry both documents, not only the policy.
  it('publishes both documents statically, before any invite', () => {
    const html = landingBody();
    expect(html).toContain('id="privacy"');
    expect(html).toContain('id="terms"');
    expect(html).toMatch(/href="#terms"/);
  });

  it('keeps the two documents\' anchors apart', () => {
    const html = landingBody();
    // Both have a section called "Complaints"; duplicate ids would make one
    // of them unreachable.
    expect(html).toContain('id="privacy-complaints"');
    expect(html).toContain('id="terms-complaints"');
  });
});

/**
 * Clause numbers are printed rather than left to an ordered list precisely so
 * that a complaint can cite one. An anchor that doesn't resolve makes the
 * citation useless.
 */
describe('clause anchors', () => {
  it('give every clause a linkable id that matches its number', () => {
    for (const path of ['/policy', '/terms']) {
      const { unmount } = renderAt(path);
      const sections = Array.from(document.querySelectorAll('section[id^="s"]'));
      expect(sections.length).toBeGreaterThan(8);
      sections.forEach((section, i) => {
        expect(section.id).toBe(`s${i + 1}`);
        expect(section.querySelector('a[href^="#"]')!.getAttribute('href')).toBe(`#${section.id}`);
      });
      unmount();
    }
  });
});

/** The pages set the document title, since both are otherwise "AFISZ" and
 *  these are the two pages people bookmark and cite. */
describe('document title', () => {
  it('names the document being read', () => {
    const { unmount } = renderAt('/policy');
    expect(document.title).toBe('Privacy policy — AFISZ');
    unmount();
    renderAt('/terms');
    expect(document.title).toBe('Terms of use — AFISZ');
  });
});
