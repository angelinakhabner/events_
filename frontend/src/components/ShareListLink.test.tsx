import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareListLink } from './ShareListLink';

const shareMock = vi.fn();
const enableMock = vi.fn();
const disableMock = vi.fn();

vi.mock('../lib/trpc', () => {
  const invalidate = () => Promise.resolve();
  return {
    trpc: {
      useUtils: () => ({ my: { wantToGo: { share: { get: { invalidate } } } } }),
      my: {
        wantToGo: {
          share: {
            get: { useQuery: () => shareMock() },
            enable: {
              useMutation: (opts?: { onSuccess?: () => void }) => ({
                mutate: () => { enableMock(); opts?.onSuccess?.(); },
                isPending: false,
                error: null,
              }),
            },
            disable: {
              useMutation: (opts?: { onSuccess?: () => void }) => ({
                mutate: () => { disableMock(); opts?.onSuccess?.(); },
                isPending: false,
                error: null,
              }),
            },
          },
        },
      },
    },
  };
});

beforeEach(() => {
  shareMock.mockReset().mockReturnValue({ data: { token: null }, isLoading: false, error: null });
  enableMock.mockReset();
  disableMock.mockReset();
});

// GOI-47: a read-only public link to the owner's list.
describe('ShareListLink', () => {
  it('offers to start sharing when there is no link yet', () => {
    render(<ShareListLink />);

    fireEvent.click(screen.getByRole('button', { name: /share this list/i }));
    expect(enableMock).toHaveBeenCalledOnce();
  });

  it('shows the link, and says plainly that anyone holding it can read the list', () => {
    shareMock.mockReturnValue({ data: { token: 'tok123' }, isLoading: false, error: null });

    render(<ShareListLink />);

    // BASE_URL is "/" under test, so the link is origin-relative.
    expect(screen.getByText(`${window.location.origin}/list/tok123`)).toBeInTheDocument();
    expect(screen.getByText(/anyone with this link/i)).toBeInTheDocument();
    expect(screen.getByText(/marked seen stay private/i)).toBeInTheDocument();
  });

  it('revokes on demand', () => {
    shareMock.mockReturnValue({ data: { token: 'tok123' }, isLoading: false, error: null });

    render(<ShareListLink />);
    fireEvent.click(screen.getByRole('button', { name: /stop sharing/i }));
    expect(disableMock).toHaveBeenCalledOnce();
  });

  it('stays out of the way while the link is still loading', () => {
    shareMock.mockReturnValue({ data: undefined, isLoading: true, error: null });

    const { container } = render(<ShareListLink />);
    expect(container).toBeEmptyDOMElement();
  });
});
