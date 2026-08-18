import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SuggestVenuesPanel } from './SuggestVenuesPanel';

/** State the mocked tRPC hooks read, reset per test. */
let suggestState: Record<string, unknown>;
const suggestMutate = vi.fn();
const addMutate = vi.fn();
let addState: Record<string, unknown>;
/** onSuccess handed to the add mutation, so a test can simulate a landed add. */
let addOnSuccess: ((data: unknown, vars: { url: string }) => void) | undefined;

vi.mock('../lib/trpc', () => ({
  trpc: {
    my: {
      venues: {
        suggestSimilar: {
          useMutation: () => ({ mutate: suggestMutate, ...suggestState }),
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

const suggestion = {
  name: 'Hamburger Bahnhof',
  url: 'https://www.smb.museum/hamburger-bahnhof',
  city: 'Berlin',
  country: 'DE',
  category: 'exhibition' as const,
  why: 'A contemporary-art institution in a converted station.',
};

const idle = { isPending: false, isSuccess: false, data: undefined, error: null };

function setup() {
  const onAdded = vi.fn();
  render(<SuggestVenuesPanel folderId="folder-1" folderName="Warsaw" onAdded={onAdded} />);
  return { onAdded };
}

/** Open the collapsed panel and type a city. */
function openWithCity(city = 'Berlin') {
  fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
  fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: city } });
}

beforeEach(() => {
  suggestState = { ...idle };
  addState = { ...idle };
  suggestMutate.mockReset();
  addMutate.mockReset();
  addOnSuccess = undefined;
});

describe('SuggestVenuesPanel', () => {
  // Collapsed by default: it costs a model call, so it must not look like
  // something that already ran.
  it('starts collapsed behind a single action', () => {
    setup();
    expect(screen.getByRole('button', { name: /propose similar venues/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^city$/i)).not.toBeInTheDocument();
  });

  it('opens to a city and an optional type', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByLabelText(/^city$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument();
  });

  it('names the folder it will match against', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByText(/Warsaw/)).toBeInTheDocument();
  });

  it('asks with the folder, city and type', () => {
    setup();
    openWithCity();
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'Museums' } });
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    expect(suggestMutate).toHaveBeenCalledWith({ listId: 'folder-1', city: 'Berlin', type: 'Museums' });
  });

  // An empty type must be absent, not an empty string the server then has to
  // treat as "no narrowing".
  it('omits the type when it is blank', () => {
    setup();
    openWithCity();
    fireEvent.click(screen.getByRole('button', { name: /^propose$/i }));
    expect(suggestMutate).toHaveBeenCalledWith({ listId: 'folder-1', city: 'Berlin', type: undefined });
  });

  it('will not ask without a city', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeDisabled();
  });

  it('trims a city of only spaces rather than asking', () => {
    setup();
    openWithCity('   ');
    expect(screen.getByRole('button', { name: /^propose$/i })).toBeDisabled();
  });

  it('shows each suggestion with its reason and a link', () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 2, suggestions: [suggestion] } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByRole('link', { name: 'Hamburger Bahnhof' })).toHaveAttribute('href', suggestion.url);
    expect(screen.getByText(/converted station/)).toBeInTheDocument();
    expect(screen.getByText(/Based on 2 venues/)).toBeInTheDocument();
  });

  it('adds a suggestion into this folder', () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 2, suggestions: [suggestion] } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(addMutate).toHaveBeenCalledWith({
      name: suggestion.name,
      url: suggestion.url,
      city: 'Berlin',
      country: 'DE',
      category: 'exhibition',
      listId: 'folder-1',
    });
  });

  it('marks a suggestion as added and stops offering it again', () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 2, suggestions: [suggestion] } };
    const { onAdded } = setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    // The real mutation fires onSuccess from outside React's batching.
    act(() => addOnSuccess?.(null, { url: suggestion.url }));
    expect(screen.getByRole('button', { name: /added/i })).toBeDisabled();
    expect(onAdded).toHaveBeenCalled();
  });

  it('says so when the model had nothing', () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 2, suggestions: [] } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByText(/Nothing came back/)).toBeInTheDocument();
  });

  it('surfaces a server error verbatim', () => {
    suggestState = { ...idle, error: { message: 'Venue suggestions need ANTHROPIC_API_KEY.' } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('ANTHROPIC_API_KEY');
  });

  it('surfaces a failed add — a hallucinated URL fails at the probe', () => {
    suggestState = { ...idle, isSuccess: true, data: { basedOn: 2, suggestions: [suggestion] } };
    addState = { ...idle, error: { message: 'That page could not be reached.' } };
    setup();
    fireEvent.click(screen.getByRole('button', { name: /propose similar venues/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached');
  });
});
