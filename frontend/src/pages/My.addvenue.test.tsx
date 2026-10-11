import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddVenueForm, withDraft } from '../components/AddVenueForm';
import type { ProbeOutcome } from '@afisz/shared';

/** Result the mocked checkUrl mutation resolves with; set per test. */
let probeResult: ProbeOutcome;
/** Every input the form sent to checkUrl, so consent can be asserted on. */
let calls: unknown[] = [];

vi.mock('../lib/trpc', async () => {
  const { useState } = await import('react');
  return {
    trpc: {
      my: {
        venues: {
          checkUrl: {
            useMutation: (opts?: { onSuccess?: (r: ProbeOutcome) => void }) => {
              const [data, setData] = useState<ProbeOutcome | null>(null);
              return {
                mutate: (input: unknown) => {
                  calls.push(input);
                  setData(probeResult);
                  opts?.onSuccess?.(probeResult);
                },
                data,
                isPending: false,
                error: null,
                reset: () => setData(null),
              };
            },
          },
        },
      },
    },
  };
});

const SCRAPABLE: ProbeOutcome = {
  status: 'success',
  normalizedUrl: 'https://palacowe.example/repertuar',
  sourceUrl: 'https://palacowe.example/repertuar',
  method: 'jsonld',
  confidence: 'high',
  suggestedName: 'Kino Pałacowe',
  language: 'pl',
  shared: false,
  sampleEvents: [
    { title: 'Perfect Days', startsAt: '2026-09-01T18:00:00.000Z' },
    { title: 'Wystawa stała', startsAt: null },
  ],
};

function check(url = 'https://palacowe.example/repertuar') {
  fireEvent.change(screen.getByLabelText(/venue page url/i), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: /^check$/i }));
}

beforeEach(() => {
  probeResult = SCRAPABLE;
  calls = [];
});

describe('AddVenueForm — guided flow', () => {
  it('walks language → free-text URL → category, with no pre-defined venue list', () => {
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);

    const language = screen.getByLabelText(/1 · language/i);
    const url = screen.getByLabelText(/2 · venue page url/i);
    expect(language).toBeInTheDocument();
    expect(url).toHaveValue(''); // free text, nothing pre-filled
    expect(screen.getByRole('group', { name: /3 · category/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const cinemaTag = screen.getByRole('button', { name: /^cinema$/i });
    expect(language.compareDocumentPosition(url) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(url.compareDocumentPosition(cinemaTag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('submits language + url + category (name falls back to the hostname) and requires a category', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);

    fireEvent.change(screen.getByLabelText(/1 · language/i), { target: { value: 'en' } });
    fireEvent.change(screen.getByLabelText(/venue page url/i), {
      target: { value: 'https://www.palacowe.example/repertuar' },
    });

    const submit = screen.getByRole('button', { name: /add venue/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^cinema$/i }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'palacowe.example', // hostname fallback — the user never typed a name
      url: 'https://www.palacowe.example/repertuar',
      category: 'cinema',
      language: 'en',
      tags: [],
    });
  });
});

describe('AddVenueForm — probe result (GOI-72 §5, §8)', () => {
  it('confirms a scrapable URL, names the venue from the page, and shows what it found', async () => {
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/✓ scrapable/i);
    expect(status).toHaveTextContent(/structured data/i);
    // Free to keep fresh — the reason we don't mind sweeping it daily.
    expect(status).toHaveTextContent(/costs nothing to keep fresh/i);
    expect(screen.getByLabelText(/name/i)).toHaveValue('Kino Pałacowe');

    // The sample events are the confirmation step: real titles, real dates.
    expect(status).toHaveTextContent('Perfect Days');
    expect(status).toHaveTextContent('1 Sep');
    // An undated entry says so rather than inventing a time.
    expect(status).toHaveTextContent('Wystawa stała');
    expect(status).toHaveTextContent('no date');
  });

  it('sends the form’s language as the probe locale, without consent to spend', () => {
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check();
    expect(calls).toEqual([
      { url: 'https://palacowe.example/repertuar', locale: 'pl', allowPaid: false },
    ]);
  });

  it('says a shared venue is already tracked instead of re-confirming it', async () => {
    probeResult = { ...SCRAPABLE, shared: true, sampleEvents: [] };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/already tracked/i);
    expect(status).toHaveTextContent(/scraped once for everyone/i);
  });

  it('warns that a low-confidence source may be news rather than events', async () => {
    probeResult = { ...SCRAPABLE, method: 'wp_rest_posts', confidence: 'low' };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check();

    expect(await screen.findByRole('status')).toHaveTextContent(/news rather than events/i);
  });
});

describe('AddVenueForm — failures render by severity, never raw', () => {
  it('shows a fatal failure in the accent colour', async () => {
    probeResult = {
      status: 'failure',
      normalizedUrl: null,
      code: 'SOCIAL_ONLY',
      severity: 'fatal',
      message: 'This is a Facebook or Instagram page. We can only read venue websites.',
    };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check('https://facebook.com/teatr');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/Facebook or Instagram/);
    expect(status.querySelector('p')).toHaveClass('text-accent');
  });

  // The distinction the ticket is explicit about: "we need something from you"
  // must not look like "this is broken".
  it('renders a needs_decision result as ink, not as breakage, and offers the way forward', async () => {
    probeResult = {
      status: 'needs_decision',
      normalizedUrl: 'https://teatr.example/',
      code: 'NO_LISTING_PAGE_FOUND',
      severity: 'needs_decision',
      message: 'We found the site but no events page. Paste the direct link to their programme.',
    };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check('https://teatr.example/');

    const status = await screen.findByRole('status');
    const line = status.querySelector('p');
    expect(line).toHaveClass('text-ink');
    expect(line).not.toHaveClass('text-accent');
    // It invites a deeper URL, because that usually works.
    expect(status).toHaveTextContent(/Repertuar/);
  });

  it('offers the paid fetch only for JS_RENDERED_NEEDS_PAID, and only on request', async () => {
    probeResult = {
      status: 'needs_decision',
      normalizedUrl: 'https://spa.example/',
      code: 'JS_RENDERED_NEEDS_PAID',
      severity: 'needs_decision',
      message: 'This site needs a full browser to read. We can try a paid fetch.',
    };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check('https://spa.example/');

    // The first check never spends.
    expect(calls).toEqual([{ url: 'https://spa.example/', locale: 'pl', allowPaid: false }]);

    const opt = await screen.findByRole('button', { name: /try paid fetch/i });
    expect(opt).toHaveTextContent(/1 credit/i);
    fireEvent.click(opt);

    // Consent is what turns it on, and it goes to the same endpoint.
    expect(calls[1]).toEqual({ url: 'https://spa.example/', locale: 'pl', allowPaid: true });
  });

  it('offers no paid button for an ordinary failure', async () => {
    probeResult = {
      status: 'needs_decision',
      normalizedUrl: 'https://v.example/',
      code: 'NO_EVENTS_FOUND',
      severity: 'needs_decision',
      message: 'We read the page but found no events on it.',
    };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);
    check('https://v.example/');

    await screen.findByRole('status');
    expect(screen.queryByRole('button', { name: /paid fetch/i })).not.toBeInTheDocument();
  });
});

describe('AddVenueForm — your own tags (GOI-74)', () => {
  function fill() {
    fireEvent.change(screen.getByLabelText(/venue page url/i), {
      target: { value: 'https://palacowe.example/repertuar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^cinema$/i }));
  }

  it('lets the user type tags of their own and submits them', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);
    fill();

    const field = screen.getByLabelText(/your tags/i);
    fireEvent.change(field, { target: { value: 'date night' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'walking distance' } });
    fireEvent.keyDown(field, { key: ',' });

    fireEvent.click(screen.getByRole('button', { name: /add venue/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['date night', 'walking distance'] }),
    );
  });

  it('does not submit the form when Enter commits a tag', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);
    fill();

    const field = screen.getByLabelText(/your tags/i);
    fireEvent.change(field, { target: { value: 'jazz' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    // You are mid-thought, not finished.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('jazz')).toBeInTheDocument();
  });

  // Nobody expects a tag they typed to vanish because they pressed the form's
  // submit rather than the tag's.
  it('keeps a half-typed tag when the form is submitted', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);
    fill();

    fireEvent.change(screen.getByLabelText(/your tags/i), { target: { value: 'unfinished' } });
    fireEvent.click(screen.getByRole('button', { name: /add venue/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tags: ['unfinished'] }));
  });

  it('removes a tag again', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);
    fill();

    const field = screen.getByLabelText(/your tags/i);
    fireEvent.change(field, { target: { value: 'jazz' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /remove tag jazz/i }));

    fireEvent.click(screen.getByRole('button', { name: /add venue/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
  });

  it('still submits with no tags at all — they are optional', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /add venue/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
  });
});

describe('withDraft', () => {
  it('trims, and ignores an empty draft', () => {
    expect(withDraft([], '  jazz  ')).toEqual(['jazz']);
    expect(withDraft(['a'], '   ')).toEqual(['a']);
  });

  it('de-duplicates case-insensitively', () => {
    expect(withDraft(['Jazz'], 'jazz')).toEqual(['Jazz']);
  });

  it('caps a tag at 40 chars and the list at 20, like the server does', () => {
    expect(withDraft([], 'x'.repeat(60))[0]).toHaveLength(40);
    const full = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(withDraft(full, 'one more')).toHaveLength(20);
  });
});
