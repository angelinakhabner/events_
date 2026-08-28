/**
 * GOI-95: /policy and /terms.
 *
 * These are legal documents, so the tests are about the obligations rather
 * than the prose: the clauses Polish law requires the regulamin to contain,
 * the disclosures RODO requires the notice to contain, that both are reachable
 * from every page, and — the one with teeth — that they are reachable *before*
 * the invite gate, since terms you can only read after signing up are not
 * available before you sign up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PolicyPage } from './Policy';
import { TermsPage } from './Terms';
import { DPA, OPERATOR } from '../lib/legal';

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

/** The whole document as one string, for "does it say X at all" checks. */
function text(): string {
  return document.body.textContent ?? '';
}

describe('privacy policy', () => {
  beforeEach(() => renderAt('/policy'));

  it('names a contact address for data requests', () => {
    const mailto = screen.getAllByRole('link', { name: OPERATOR.email })[0]!;
    expect(mailto).toHaveAttribute('href', `mailto:${OPERATOR.email}`);
  });

  /** Art. 13(2)(d) RODO: the notice must name the supervisory authority the
   *  reader can complain to, and in Poland that is a specific office. */
  it('names the Polish supervisory authority and how to reach it', () => {
    expect(text()).toContain(DPA.name);
    expect(text()).toContain(DPA.address);
    expect(screen.getByRole('link', { name: /uodo\.gov\.pl/i })).toHaveAttribute('href', DPA.url);
  });

  it('states a legal basis for each purpose it describes', () => {
    // Art. 6(1)(a) consent, (b) contract and (f) legitimate interest are the
    // three this service actually relies on; all three have to be named.
    for (const basis of ['art. 6(1)(a)', 'art. 6(1)(b)', 'art. 6(1)(f)']) {
      expect(text()).toContain(basis);
    }
  });

  it('lists every data subject right, including withdrawal of consent', () => {
    for (const right of [
      'art. 15', 'art. 16', 'art. 17', 'art. 18', 'art. 20', 'art. 21', 'art. 7(3)',
    ]) {
      expect(text()).toContain(right);
    }
  });

  it('names the processors that actually receive data', () => {
    for (const processor of ['Railway', 'GitHub Pages', 'Resend', 'Google', 'Anthropic']) {
      expect(text()).toContain(processor);
    }
  });

  it('addresses transfers outside the EEA', () => {
    expect(text()).toMatch(/Standard Contractual Clauses/i);
    expect(text()).toMatch(/Data Privacy Framework/i);
  });

  it('says how long each kind of data is kept', () => {
    const retention = document.querySelector('#s6')!;
    expect(within(retention as HTMLElement).getByText(/15 minutes/)).toBeInTheDocument();
    expect(retention.textContent).toMatch(/until you delete your account/i);
  });

  /** The claims that would be false if a tracker were ever added. They are
   *  asserted so that adding one without amending this page breaks a test. */
  it('states plainly that there is no advertising, analytics or profiling', () => {
    expect(text()).toMatch(/do not sell or rent personal data/i);
    expect(text()).toMatch(/no advertising/i);
    expect(text()).toMatch(/no analytics/i);
    expect(text()).toMatch(/art\. 22 GDPR/);
  });

  it('explains the browser storage it uses in place of a cookie banner', () => {
    expect(text()).toMatch(/local storage/i);
    expect(text()).toMatch(/Prawo telekomunikacyjne/);
  });

  it('carries the date it was last changed', () => {
    expect(screen.getByText(/^Last updated \d{1,2} \w+ \d{4}$/)).toBeInTheDocument();
  });

  it('links to the terms', () => {
    expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute('href', '/terms');
  });
});

describe('terms of use', () => {
  beforeEach(() => renderAt('/terms'));

  /**
   * Art. 8(3) of the ustawa o świadczeniu usług drogą elektroniczną fixes the
   * minimum contents of a regulamin. One clause each.
   */
  it('covers everything art. 8(3) UŚUDE requires of a regulamin', () => {
    expect(text()).toMatch(/What the service does/i);          // scope
    expect(text()).toMatch(/What you need to use it/i);        // technical requirements
    expect(text()).toMatch(/must not supply unlawful content/i); // unlawful content
    expect(text()).toMatch(/Complaints/i);                     // complaints procedure
  });

  it('gives a complaints route and a deadline for answering', () => {
    const complaints = document.querySelector('#s9')!;
    expect(complaints.textContent).toMatch(/14 days/);
    expect(complaints.textContent).toContain(OPERATOR.email);
  });

  it('states the consumer right of withdrawal rather than disclaiming it', () => {
    const consumer = document.querySelector('#s10')!;
    expect(consumer.textContent).toMatch(/withdraw from the contract within 14 days/i);
    expect(consumer.textContent).toMatch(/ustawa o prawach konsumenta/);
  });

  /** The listings are scraped and can be wrong; saying so is the point of the
   *  clause, and "check with the venue" is the actionable half. */
  it('is honest about the accuracy of scraped listings', () => {
    expect(text()).toMatch(/Check with the venue before you set out/i);
    expect(text()).toMatch(/not as a guarantee/i);
  });

  it('does not purport to exclude liability the law will not let it exclude', () => {
    expect(text()).toMatch(/not excluded or limited for wilful misconduct/i);
    expect(text()).toMatch(/the law prevails/i);
  });

  it('says the newsletter is sent on consent that can be withdrawn', () => {
    const brief = document.querySelector('#s5')!;
    expect(brief.textContent).toMatch(/withdraw that consent at any time/i);
    expect(brief.textContent).toMatch(/unsubscribe link/i);
  });

  it('names the governing law', () => {
    expect(text()).toMatch(/governed by Polish law/i);
  });

  it('links to the privacy policy', () => {
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/policy');
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
      const anchors = Array.from(document.querySelectorAll('section[id^="s"]'));
      expect(anchors.length).toBeGreaterThan(8);
      for (const section of anchors) {
        const link = section.querySelector('a[href^="#"]')!;
        expect(link.getAttribute('href')).toBe(`#${section.id}`);
      }
      unmount();
    }
  });
});

/** The pages set the document title, since both are otherwise "AFISZ" and
 *  these are the two pages people bookmark and cite. */
describe('document title', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names the document being read', () => {
    const { unmount } = renderAt('/policy');
    expect(document.title).toBe('Privacy policy — AFISZ');
    unmount();
    renderAt('/terms');
    expect(document.title).toBe('Terms of use — AFISZ');
  });
});
