import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ProbeOutcome } from '@afisz/shared';
import {
  ElsewherePanel,
  candidateNote,
  candidateStatus,
  eventsInWindow,
  isoDay,
  presetWindow,
  probeFacts,
  probeWithConcurrency,
  windowNote,
  windowProblem,
} from './ElsewherePanel';

/**
 * "Elsewhere" discovery (GOI-92).
 *
 * The thing worth testing here is not the form — it is the promises the form
 * makes: that the ask someone actually has ("jazz concerts in Thessaloniki
 * tomorrow") can be expressed, that every candidate says whether we can
 * actually read it, that the dates are checked against what we read rather
 * than asserted, that a candidate we can't read is still addable *with its
 * reason*, and that nothing on this screen ever spends money on a browser
 * render.
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
/** A readable venue whose programme we could sample — the case the date
 *  window is actually checked against. */
const withProgramme = (startsAt: (string | null)[]): ProbeOutcome => ({
  ...(ok as Extract<ProbeOutcome, { status: 'success' }>),
  sampleEvents: startsAt.map((at, i) => ({ title: `Gig ${i + 1}`, startsAt: at })),
});

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

/** Mount the way the tab really does: the folders arrive from a query, so the
 *  first render has none and no active folder (GOI-116). */
function setupLoading() {
  const onAdded = vi.fn();
  const view = render(<ElsewherePanel folders={[]} activeFolderId={null} onAdded={onAdded} />);
  return {
    onAdded,
    loaded: () =>
      view.rerender(
        <ElsewherePanel folders={folders} activeFolderId="folder-1" onAdded={onAdded} />,
      ),
  };
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

  it('opens to the whole ask: city, interest, types, dates, folder, destination', () => {
    setup();
    open();
    expect(screen.getByLabelText(/^city$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/looking for/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /venue types/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^until$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/match against/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/destination/i)).toBeInTheDocument();
  });

  it('matches against the folder you are in, by default', () => {
    setup();
    open();
    expect(screen.getByLabelText(/match against/i)).toHaveValue('folder-1');
  });

  /**
   * GOI-116: "propose button is not active". The folders arrive from a query,
   * so the first render has none — and the folder id was read once, by a
   * `useState` initialiser, which is ignored on every render after it. The
   * state stayed empty while the select displayed a folder (a value matching
   * no option shows the first one), so the form looked complete and the button
   * was disabled by a condition the reader could not satisfy.
   */
  it('follows the folder you are in once the folders arrive', () => {
    const { loaded } = setupLoading();
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    // The button no longer waits on a folder — the search stands on its own —
    // but the control must still catch up with the tab it was opened from.
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeEnabled();

    loaded();

    expect(screen.getByLabelText(/match against/i)).toHaveValue('folder-1');
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeEnabled();
  });

  it('searches with the folder the select is showing, not an empty id', async () => {
    const { loaded } = setupLoading();
    open();
    loaded();
    suggestMutateAsync.mockResolvedValue({ suggestions: [] });

    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    });

    expect(suggestMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'folder-1', city: 'Berlin' }),
    );
  });

  it('keeps the reader\u2019s own choice once they make one', () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText(/match against/i), { target: { value: 'folder-2' } });
    expect(screen.getByLabelText(/match against/i)).toHaveValue('folder-2');
  });

  /**
   * GOI-116 ended with a dead button being *explained* here: with no folder,
   * there was no taste to search from. There is now — a city, dates and an
   * interest are a search — so the button works instead of apologising.
   */
  it('searches with no folders at all', async () => {
    render(<ElsewherePanel folders={[]} activeFolderId={null} onAdded={vi.fn()} />);
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeEnabled();

    suggestMutateAsync.mockResolvedValue({ suggestions: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    });
    expect(suggestMutateAsync).toHaveBeenCalledWith({ city: 'Berlin', limit: 8 });
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

  // Venue *types* must come from the categories the rest of the tab uses —
  // a parallel vocabulary here would produce folders nothing else can filter.
  it('offers the existing category vocabulary as the venue types', () => {
    setup();
    open();
    for (const label of ['Cinema', 'Theatre', 'Museums', 'Comedy', 'Music']) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked();
    }
  });

  // Someone after live music will take a jazz club *and* a concert hall; the
  // old one-of-five dropdown made them choose.
  it('takes several types at once', () => {
    setup();
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Music' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Theatre' }));
    expect(screen.getByRole('checkbox', { name: 'Music' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Theatre' })).toBeChecked();
  });

  it('will not search a window that ends before it starts', () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '2026-09-14' } });
    fireEvent.change(screen.getByLabelText(/^until$/i), { target: { value: '2026-09-11' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/before its start/i);
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeDisabled();
  });

  // "Tomorrow" is the ask this panel exists for; making someone type two dates
  // to say it would be the interface arguing with the sentence.
  it('fills both dates from one preset', () => {
    setup();
    open();
    fireEvent.click(screen.getByRole('button', { name: /^tomorrow$/i }));
    const tomorrow = presetWindow('tomorrow').from;
    expect(screen.getByLabelText(/^from$/i)).toHaveValue(tomorrow);
    expect(screen.getByLabelText(/^until$/i)).toHaveValue(tomorrow);
    expect(screen.getByRole('button', { name: /^tomorrow$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the dates again', () => {
    setup();
    open();
    fireEvent.click(screen.getByRole('button', { name: /^tomorrow$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^any dates$/i }));
    expect(screen.getByLabelText(/^from$/i)).toHaveValue('');
    expect(screen.getByLabelText(/^until$/i)).toHaveValue('');
  });

  // A city you have never been to has nothing to match against.
  it('can search without matching a folder at all', () => {
    setup();
    open();
    expect(screen.getByRole('option', { name: /nothing — just the search/i })).toBeInTheDocument();
  });
});

describe('searching and probing', () => {
  beforeEach(() => {
    suggestMutateAsync.mockResolvedValue({ basedOn: 3, suggestions: [bahnhof, volksbuehne] });
    checkUrl.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve(url === bahnhof.url ? ok : blocked),
    );
  });

  it('asks with the whole sentence: city, interest, types, dates, folder, cap', async () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Thessaloniki' } });
    fireEvent.change(screen.getByLabelText(/looking for/i), { target: { value: 'jazz concerts' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Music' }));
    fireEvent.click(screen.getByRole('button', { name: /^tomorrow$/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    });
    const tomorrow = presetWindow('tomorrow').from;
    expect(suggestMutateAsync).toHaveBeenCalledWith({
      listId: 'folder-1',
      city: 'Thessaloniki',
      interest: 'jazz concerts',
      types: ['Music'],
      from: tomorrow,
      until: tomorrow,
      limit: 8,
    });
  });

  // Empty fields are omitted rather than sent as '' — the server reads an
  // absent field as "not narrowed", and an empty string as a bad value.
  it('leaves out what was not filled in', async () => {
    setup();
    await search();
    expect(suggestMutateAsync).toHaveBeenCalledWith({
      listId: 'folder-1',
      city: 'Berlin',
      limit: 8,
    });
  });

  it('drops the folder from the ask when none is matched against', async () => {
    setup();
    open();
    fireEvent.change(screen.getByLabelText(/match against/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    });
    expect(suggestMutateAsync).toHaveBeenCalledWith({ city: 'Berlin', limit: 8 });
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

describe('the dates are checked, not claimed', () => {
  beforeEach(() => {
    suggestMutateAsync.mockResolvedValue({ basedOn: 3, suggestions: [bahnhof, volksbuehne] });
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 3, suggestions: [bahnhof, volksbuehne] } };
  });

  /** Search Berlin for a fixed two-day window. */
  async function searchDates() {
    open();
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '2026-09-11' } });
    fireEvent.change(screen.getByLabelText(/^until$/i), { target: { value: '2026-09-12' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    });
  }

  it('names what the venue has on in the window, from its own programme', async () => {
    checkUrl.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve(
        url === bahnhof.url
          ? withProgramme(['2026-09-11T19:00:00.000Z', '2026-10-02T19:00:00.000Z'])
          : blocked,
      ),
    );
    setup();
    await searchDates();
    await waitFor(() =>
      expect(screen.getByTestId(`dates-${bahnhof.url}`)).toHaveTextContent('Gig 1'),
    );
    // The October entry is outside the window and must not be counted.
    expect(screen.getByTestId(`dates-${bahnhof.url}`)).not.toHaveTextContent('Gig 2');
  });

  // A probe samples the first few entries it finds. Saying "nothing on" would
  // be a claim about the venue; what we can honestly report is what we read.
  it('says nothing matched *among what we sampled*, not that the venue is dark', async () => {
    checkUrl.mockResolvedValue(withProgramme(['2026-10-02T19:00:00.000Z']));
    setup();
    await searchDates();
    await waitFor(() =>
      expect(screen.getByTestId(`dates-${bahnhof.url}`)).toHaveTextContent(/listings we sampled/i),
    );
  });

  it('counts how many candidates had something on', async () => {
    checkUrl.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve(
        url === bahnhof.url ? withProgramme(['2026-09-12T19:00:00.000Z']) : withProgramme([]),
      ),
    );
    setup();
    await searchDates();
    await waitFor(() =>
      expect(screen.getByTestId('window-summary')).toHaveTextContent('1 of 2'),
    );
  });

  it('says nothing about dates when none were given', async () => {
    checkUrl.mockResolvedValue(withProgramme(['2026-09-11T19:00:00.000Z']));
    setup();
    await search();
    await waitFor(() => expect(checkUrl).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId(`dates-${bahnhof.url}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('window-summary')).not.toBeInTheDocument();
  });
});

describe('eventsInWindow / windowNote', () => {
  const window = { from: '2026-09-11', until: '2026-09-12' };

  it('keeps the entries inside the window, inclusive of both ends', () => {
    const outcome = withProgramme([
      '2026-09-10T20:00:00.000Z',
      '2026-09-11T20:00:00.000Z',
      '2026-09-12T20:00:00.000Z',
      '2026-09-13T20:00:00.000Z',
    ]);
    expect(eventsInWindow(outcome, window.from, window.until).map((e) => e.title)).toEqual([
      'Gig 2', 'Gig 3',
    ]);
  });

  // A permanent exhibition is not "on" on any particular day; counting undated
  // entries would make every museum a hit for every window.
  it('does not count undated entries as matches', () => {
    expect(eventsInWindow(withProgramme([null, null]), window.from, window.until)).toEqual([]);
  });

  it('takes an open-ended window from either side', () => {
    const outcome = withProgramme(['2026-09-10T20:00:00.000Z', '2026-09-13T20:00:00.000Z']);
    expect(eventsInWindow(outcome, '2026-09-12', '').map((e) => e.title)).toEqual(['Gig 2']);
    expect(eventsInWindow(outcome, '', '2026-09-12').map((e) => e.title)).toEqual(['Gig 1']);
  });

  it('has nothing to say about a venue we could not read', () => {
    expect(eventsInWindow(blocked, window.from, window.until)).toEqual([]);
    expect(windowNote(blocked, window.from, window.until)).toBeNull();
    expect(windowNote(undefined, window.from, window.until)).toBeNull();
  });

  it('distinguishes "read nothing dated" from "read nothing matching"', () => {
    expect(windowNote(withProgramme([]), window.from, window.until)).toMatch(/no dated listing/i);
    expect(windowNote(withProgramme(['2026-10-02T20:00:00.000Z']), window.from, window.until))
      .toMatch(/nothing in your dates/i);
  });

  it('caps the titles it names and counts the rest', () => {
    const note = windowNote(
      withProgramme([
        '2026-09-11T18:00:00.000Z', '2026-09-11T20:00:00.000Z',
        '2026-09-12T18:00:00.000Z', '2026-09-12T20:00:00.000Z',
      ]),
      window.from,
      window.until,
    )!;
    expect(note).toMatch(/Gig 3/);
    expect(note).not.toMatch(/Gig 4/);
    expect(note).toMatch(/\+1 more/);
  });
});

describe('presetWindow / windowProblem', () => {
  it('reads "tomorrow" off the user\'s own calendar, not UTC', () => {
    // 23:30 local on the 11th: `toISOString()` would already say the 12th.
    const lateEvening = new Date(2026, 8, 11, 23, 30);
    expect(presetWindow('tomorrow', lateEvening)).toEqual({ from: '2026-09-12', until: '2026-09-12' });
    expect(isoDay(lateEvening)).toBe('2026-09-11');
  });

  it('runs "next 7 days" from today inclusive', () => {
    expect(presetWindow('week', new Date(2026, 8, 11))).toEqual({
      from: '2026-09-11', until: '2026-09-17',
    });
  });

  // Never the weekend just gone: on a weekday it is the one still to come, and
  // inside a weekend it is the part that is left.
  it.each([
    ['a Wednesday', new Date(2026, 8, 9), { from: '2026-09-12', until: '2026-09-13' }],
    ['a Saturday', new Date(2026, 8, 12), { from: '2026-09-12', until: '2026-09-13' }],
    ['a Sunday', new Date(2026, 8, 13), { from: '2026-09-13', until: '2026-09-13' }],
  ])('resolves "this weekend" on %s', (_name, today, expected) => {
    expect(presetWindow('weekend', today)).toEqual(expected);
  });

  it('holds a backwards or over-long window, and passes everything else', () => {
    expect(windowProblem('2026-09-14', '2026-09-11')).toMatch(/before its start/i);
    expect(windowProblem('2026-01-01', '2026-06-01')).toMatch(/at most/i);
    expect(windowProblem('2026-09-11', '2026-09-11')).toBeNull();
    expect(windowProblem('', '2026-09-11')).toBeNull();
    expect(windowProblem('2026-09-11', '')).toBeNull();
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
