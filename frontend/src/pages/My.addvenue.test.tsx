import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddVenueForm } from '../components/AddVenueForm';
import type { ProbeResult } from '../../../backend/src/services/scraper/probe';

/** Result the mocked checkUrl mutation resolves with; set per test. */
let probeResult: ProbeResult;

vi.mock('../lib/trpc', async () => {
  const { useState } = await import('react');
  return {
    trpc: {
      my: {
        venues: {
          checkUrl: {
            useMutation: (opts?: { onSuccess?: (r: ProbeResult) => void }) => {
              const [data, setData] = useState<ProbeResult | null>(null);
              return {
                mutate: () => {
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

const SCRAPABLE: ProbeResult = {
  ok: true, method: 'structured-data', eventCount: 12, reason: null,
  title: 'Kino Pałacowe', language: 'pl',
};

beforeEach(() => {
  probeResult = SCRAPABLE;
});

describe('AddVenueForm — guided flow', () => {
  it('walks language → free-text URL → tag, with no pre-defined venue list', () => {
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);

    const language = screen.getByLabelText(/1 · language/i);
    const url = screen.getByLabelText(/2 · venue page url/i);
    expect(language).toBeInTheDocument();
    expect(url).toHaveValue(''); // free text, nothing pre-filled
    expect(screen.getByRole('group', { name: /3 · tag/i })).toBeInTheDocument();
    // No checkbox list of pre-defined venues anywhere in the form.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // The steps appear in the promised order: language before URL before tag.
    const cinemaTag = screen.getByRole('button', { name: /^cinema$/i });
    expect(language.compareDocumentPosition(url) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(url.compareDocumentPosition(cinemaTag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('checking a scrapable URL turns green and suggests the venue name from the page', async () => {
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);

    fireEvent.change(screen.getByLabelText(/venue page url/i), {
      target: { value: 'https://palacowe.example/repertuar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^check$/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/✓ scrapable/i);
    expect(status).toHaveTextContent(/12 upcoming events/i);
    expect(status).toHaveClass('text-green-700');
    expect(screen.getByLabelText(/name/i)).toHaveValue('Kino Pałacowe');
  });

  it('shows the reason in red when the URL cannot be scraped', async () => {
    probeResult = {
      ok: false, method: null, eventCount: null, title: null, language: null,
      reason: "Couldn't fetch the page: HTTP 403",
    };
    render(<AddVenueForm onSubmit={vi.fn()} submitting={false} error={null} />);

    fireEvent.change(screen.getByLabelText(/venue page url/i), {
      target: { value: 'https://blocked.example/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^check$/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/HTTP 403/);
    expect(status).toHaveClass('text-red-700');
  });

  it('submits language + url + tag (name falls back to the hostname) and requires a tag', () => {
    const onSubmit = vi.fn();
    render(<AddVenueForm onSubmit={onSubmit} submitting={false} error={null} />);

    fireEvent.change(screen.getByLabelText(/1 · language/i), { target: { value: 'en' } });
    fireEvent.change(screen.getByLabelText(/venue page url/i), {
      target: { value: 'https://www.palacowe.example/repertuar' },
    });

    // No tag picked yet → the submit button is disabled.
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
    });
  });
});
