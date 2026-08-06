import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DEFAULT_SHARE_TEMPLATE } from '@afisz/shared';
import { SettingsSection } from './SettingsSection';

const getMock = vi.fn();
const saveMock = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ my: { settings: { get: { invalidate: () => Promise.resolve() } } } }),
    my: {
      settings: {
        get: { useQuery: () => getMock() },
        save: {
          useMutation: (opts?: { onSuccess?: (d: { shareText: string }) => void }) => ({
            mutate: (input: { shareText: string }) => {
              saveMock(input);
              opts?.onSuccess?.({ shareText: input.shareText });
            },
            isPending: false,
            error: null,
          }),
        },
      },
    },
  },
}));

beforeEach(() => {
  getMock.mockReset().mockReturnValue({
    data: { shareText: DEFAULT_SHARE_TEMPLATE },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  saveMock.mockReset();
});

// GOI-49 follow-up: sharing is the one place the app puts words in the
// reader's mouth, so the wording has to be theirs to change.
describe('SettingsSection', () => {
  it('starts from the saved template', () => {
    getMock.mockReturnValue({
      data: { shareText: 'Fancy {title}?' },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<SettingsSection />);
    expect(screen.getByLabelText(/sharing text/i)).toHaveValue('Fancy {title}?');
  });

  // The preview is the point of the screen — placeholders only become obvious
  // once you watch one fill in.
  it('previews the live template against an example event', () => {
    render(<SettingsSection />);
    const preview = screen.getByTestId('share-preview');
    expect(preview).toHaveTextContent(/^Darling, let's go to Perfect Days at Kino Muranów together/);

    fireEvent.change(screen.getByLabelText(/sharing text/i), {
      target: { value: 'Fancy {title}{venue}?' },
    });
    expect(preview).toHaveTextContent('Fancy Perfect Days at Kino Muranów?');
  });

  it('saves what is in the field', () => {
    render(<SettingsSection />);
    fireEvent.change(screen.getByLabelText(/sharing text/i), { target: { value: 'Come to {title}' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(saveMock).toHaveBeenCalledWith({ shareText: 'Come to {title}' });
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  it('offers a reset only once the wording differs from the default', () => {
    render(<SettingsSection />);
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/sharing text/i), { target: { value: 'Mine {title}' } });
    fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));

    expect(screen.getByLabelText(/sharing text/i)).toHaveValue(DEFAULT_SHARE_TEMPLATE);
  });

  it('says so when the settings fail to load', () => {
    getMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: { message: 'nope' },
      refetch: vi.fn(),
    });

    render(<SettingsSection />);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load your settings/i);
  });
});
