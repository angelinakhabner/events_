import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ProbeOutcome } from '@afisz/shared';
import {
  ElsewherePanel,
  candidateNote,
  candidateStatus,
  probeFacts,
  probeWithConcurrency,
} from './ElsewherePanel';

/**
 * "Elsewhere" discovery (GOI-92).
 *
 * The thing worth testing here is not the form — it is the promise the form
 * makes: every candidate says whether we can actually read it, a candidate we
 * can't read is still addable *with its reason*, and nothing on this screen
 * ever spends money on a browser render.
 */

let suggestState: Record<string, unknown>;
let addState: Record<string, unknown>;
const suggestMutateAsync = vi.fn();
const addMutate = vi.fn();
const checkUrl = vi.fn();
let addOnSuccess: ((data: unknown, vars: { url: string }) => void) | undefined;

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ client: { my: { venues: { checkUrl: { mutate: checkUrl } } } } }),
    my: {
      venues: {
        suggestSimilar: {
          useMutation: () => ({ mutateAsync: suggestMutateAsync, ...suggestState }),
        },
        add: {
          useMutation: (opts?: { onSuccess?: (d: unknown, v: { url: string }) => void }) => {
            addOnSuccess = opts?.onSuccess;
            return { mutate: addMutate, ...addState };
          },
        },
      },
    },
  },
}));

const folders = [
  { id: 'folder-1', name: 'Warsaw' },
  { id: 'folder-2', name: 'Poznan' },
];

const bahnhof = {
  name: 'Hamburger Bahnhof',
  url: 'https://www.smb.museum/hamburger-bahnhof',
  city: 'Berlin',
  country: 'DE',
  category: 'exhibition' as const,
  why: 'A contemporary-art institution in a converted station.',
};
const volksbuehne = {
  name: 'Volksbühne',
  url: 'https://www.volksbuehne.berlin',
  city: 'Berlin',
  country: 'DE',
  category: 'theatre' as const,
  why: 'Big-house repertory with an experimental streak.',
};

const ok: ProbeOutcome = {
  status: 'success',
  normalizedUrl: bahnhof.url,
  sourceUrl: `${bahnhof.url}/programm`,
  method: 'jsonld',
  confidence: 'high',
  suggestedName: 'Hamburger Bahnhof',
  language: 'de',
  sampleEvents: [],
  shared: false,
};
const needsPaid: ProbeOutcome = {
  status: 'needs_decision',
  normalizedUrl: volksbuehne.url,
  code: 'JS_RENDERED_NEEDS_PAID',
  severity: 'needs_decision',
  message: 'This page only renders in a browser.',
};
const blocked: ProbeOutcome = {
  status: 'failure',
  normalizedUrl: volksbuehne.url,
  code: 'BLOCKED',
  severity: 'retryable',
  message: 'The site refused our request (403).',
};

const idle = { isPending: false, isSuccess: false, data: undefined, error: null };

function setup() {
  const onAdded = vi.fn();
  render(<ElsewherePanel folders={folders} activeFolderId="folder-1" onAdded={onAdded} />);
  return { onAdded };
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /^elsewhere$/i }));
}

/** Open, type a city, submit — and let the probe round-trips settle. */
async function search(city = 'Berlin') {
  open();
  fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: city } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
  });
}

beforeEach(() => {
  suggestState = { ...idle };
  addState = { ...idle };
  suggestMutateAsync.mockReset();
  addMutate.mockReset();
  checkUrl.mockReset();
  addOnSuccess = undefined;
});

describe('the trigger', () => {
  it('starts collapsed behind one button — a search costs a model call', () => {
    setup();
    expect(screen.getByRole('button', { name: /^elsewhere$/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByLabelText(/^city$/i)).not.toBeInTheDocument();
  });

  it('opens to city, venue type, match against and destination', () => {
    setup();
    open();
    expect(screen.getByLabelText(/^city$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/venue type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/match against/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/destination/i)).toBeInTheDocument();
  });

  it('matches against the folder you are in, by default', () => {
    setup();
    open();
    expect(screen.getByLabelText(/match against/i)).toHaveValue('folder-1');
  });

  it('will not search without a city', () => {
    setup();
    open();
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeDisabled();
  });

  it('names the folder it would create, so the default destination is not a mystery', () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    expect(screen.getByRole('option', { name: /new folder: berlin/i })).toBeInTheDocument();
  });

  // Venue *type* must come from the categories the rest of the tab uses —
  // a parallel vocabulary here would produce folders nothing else can filter.
  it('offers the existing category vocabulary as the venue type', () => {
    setup();
    open();
    const type = screen.getByLabelText(/venue type/i);
    for (const label of ['Cinema', 'Theatre', 'Museums', 'Comedy', 'Music']) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
    expect(type).toHaveValue('');
  });
});

describe('searching and probing', () => {
  beforeEach(() => {
    suggestMutateAsync.mockResolvedValue({ basedOn: 3, suggestions: [bahnhof, volksbuehne] });
    checkUrl.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve(url === bahnhof.url ? ok : blocked),
    );
  });

  it('asks with the folder, city, type and the candidate cap', async () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText(/venue type/i), { target: { value: 'theatre' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    });
    expect(suggestMutateAsync).toHaveBeenCalledWith({
      listId: 'folder-1',
      city: 'Berlin',
      type: 'Theatre',
      limit: 8,
    });
  });

  it('probes every candidate through the existing checker', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof, volksbuehne] } };
    setup();
    await search();
    await waitFor(() => expect(checkUrl).toHaveBeenCalledTimes(2));
    expect(checkUrl.mock.calls.map((c) => c[0].url)).toEqual(
      expect.arrayContaining([bahnhof.url, volksbuehne.url]),
    );
  });

  // The non-negotiable one: discovery must never spend a paid render.
  it('never asks for a paid fetch while discovering', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof, volksbuehne] } };
    setup();
    await search();
    await waitFor(() => expect(checkUrl).toHaveBeenCalledTimes(2));
    for (const [args] of checkUrl.mock.calls) {
      expect(args.allowPaid).toBe(false);
    }
  });

  it('shows the method that matched, and the specific reason when one fails', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof, volksbuehne] } };
    setup();
    await search();
    await waitFor(() => {
      expect(screen.getByTestId(`probe-${bahnhof.url}`)).toHaveTextContent('JSON-LD');
    });
    expect(screen.getByTestId(`probe-${volksbuehne.url}`)).toHaveTextContent('refused our request');
  });

  it('keeps a failed candidate addable, and carries the reason into the add', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof, volksbuehne] } };
    setup();
    await search();
    await waitFor(() =>
      expect(screen.getByTestId(`probe-${volksbuehne.url}`)).toHaveTextContent('refused'),
    );
    const rows = screen.getAllByRole('button', { name: /^add$/i });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]!);
    expect(addMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: volksbuehne.url,
        listName: 'Berlin',
        probe: { probeErrorCode: 'BLOCKED', requiresPaidFetch: false },
      }),
    );
  });

  it('adds into a chosen folder by id instead of creating one', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof] } };
    setup();
    await search();
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: 'folder-2' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);
    const call = addMutate.mock.calls[0]![0];
    expect(call.listId).toBe('folder-2');
    expect(call.listName).toBeUndefined();
  });

  it('marks an added candidate and stops offering it', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof] } };
    const { onAdded } = setup();
    await search();
    fireEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);
    act(() => addOnSuccess?.(null, { url: bahnhof.url }));
    expect(screen.getByRole('button', { name: /added/i })).toBeDisabled();
    expect(onAdded).toHaveBeenCalled();
  });

  it('surfaces a search failure verbatim', async () => {
    suggestState = { ...idle, error: { message: 'Venue suggestions need ANTHROPIC_API_KEY.' } };
    suggestMutateAsync.mockRejectedValue(new Error('nope'));
    setup();
    await search();
    expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY');
  });

  it('says so when the model had nothing', async () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [] } };
    suggestMutateAsync.mockResolvedValue({ basedOn: 3, suggestions: [] });
    setup();
    await search();
    expect(screen.getByText(/Nothing came back/)).toBeInTheDocument();
  });
});

describe('candidateStatus / candidateNote', () => {
  it('is checking until the probe lands', () => {
    expect(candidateStatus(undefined)).toBe('checking');
    expect(candidateNote(undefined)).toMatch(/checking/i);
  });

  it('reports the method for a readable venue', () => {
    expect(candidateStatus(ok)).toBe('ok');
    expect(candidateNote(ok)).toBe('JSON-LD');
  });

  // A paid-only venue is neither fine nor broken: it is a decision, and the
  // note has to say the cost is why nothing happened.
  it('flags a paid-render-only venue without running anything', () => {
    expect(candidateStatus(needsPaid)).toBe('needs_paid');
    expect(candidateNote(needsPaid)).toMatch(/not run here/i);
  });

  it('passes a failure through as its own specific sentence', () => {
    expect(candidateStatus(blocked)).toBe('failed');
    expect(candidateNote(blocked)).toBe(blocked.message);
    expect(candidateNote(blocked)).not.toMatch(/couldn.t check/i);
  });

  it('persists the method on success and the reason on failure', () => {
    expect(probeFacts(ok)).toEqual({
      sourceUrl: ok.sourceUrl,
      sourceMethod: 'jsonld',
      sourceConfidence: 'high',
    });
    expect(probeFacts(blocked)).toEqual({ probeErrorCode: 'BLOCKED', requiresPaidFetch: false });
    expect(probeFacts(needsPaid)).toEqual({
      probeErrorCode: 'JS_RENDERED_NEEDS_PAID',
      requiresPaidFetch: true,
    });
    expect(probeFacts(undefined)).toBeUndefined();
  });
});

describe('probeWithConcurrency', () => {
  it('never has more than the cap in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const urls = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    await probeWithConcurrency(
      urls,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return ok;
      },
      () => {},
      3,
    );
    expect(peak).toBe(3);
  });

  it('reports each result as it lands, not at the end', async () => {
    const seen: string[] = [];
    await probeWithConcurrency(['a', 'b'], async () => ok, (url) => seen.push(url), 1);
    expect(seen).toEqual(['a', 'b']);
  });

  // One dead candidate must not leave the rest stuck on "Checking…".
  it('turns a thrown probe into a per-row answer, and finishes the batch', async () => {
    const results: Record<string, ProbeOutcome> = {};
    await probeWithConcurrency(
      ['a', 'b'],
      async (url) => {
        if (url === 'a') throw new Error('timed out after 15s');
        return ok;
      },
      (url, outcome) => { results[url] = outcome; },
      2,
    );
    expect(results.a).toMatchObject({ status: 'failure', message: 'timed out after 15s' });
    expect(results.b).toMatchObject({ status: 'success' });
  });
});
