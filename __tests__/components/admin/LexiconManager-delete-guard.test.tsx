/**
 * Deleting a lexicon word takes two deliberate clicks.
 *
 * ⚠️ WHY THESE EXIST. Delete used to fire on the FIRST click, from a plain text
 * button sitting 8px from Archive in a 1,047-row table. The repository does a
 * hard `DynamoDBOperations.delete`: point-in-time recovery is enabled, but
 * getting one headword back means restoring the whole table to a timestamp,
 * which nobody will do for a single row. So a misclick was permanent, and the
 * reversible thing it was probably meant to hit was the button next to it.
 *
 * No test covered the delete path at all before this.
 */
// react-hot-toast renders through a <Toaster/> that this tree does not mount,
// so the message never reaches the DOM. Assert on the call instead of the paint.
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import toast from 'react-hot-toast';
import { LexiconManager, type LexiconRow } from '@/components/admin/LexiconManager';

const toastError = toast.error as unknown as jest.Mock;

const ROW: LexiconRow = {
  id: 'lex_1', word: 'நிலா', gloss: 'moon', register: 'sangam',
  usage: 'fresh', themes: [], usageCount: 0, archived: false,
};

const deleteCalls = () =>
  (global.fetch as jest.Mock).mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
  );

function mockFetch(res: Partial<Response> & { json?: () => Promise<unknown> } = {}) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    ...res,
  }) as Response);
}

const deleteButton = () => screen.getByRole('button', { name: /^Delete நிலா$/ });
const armedButton = () => screen.getByRole('button', { name: /Confirm deleting நிலா/ });

beforeEach(() => { mockFetch(); toastError.mockClear(); });
afterEach(() => jest.restoreAllMocks());

describe('the first click only arms', () => {
  it('does NOT send a DELETE on the first click', () => {
    render(<LexiconManager initial={[ROW]} />);
    fireEvent.click(deleteButton());
    expect(deleteCalls()).toHaveLength(0);
  });

  it('says what the second click will do, and that it cannot be undone', () => {
    render(<LexiconManager initial={[ROW]} />);
    fireEvent.click(deleteButton());
    expect(armedButton()).toHaveTextContent('Delete for good?');
    expect(armedButton().getAttribute('aria-label')).toMatch(/cannot be undone/);
  });

  it('leaves the row on screen while armed', () => {
    render(<LexiconManager initial={[ROW]} />);
    fireEvent.click(deleteButton());
    expect(screen.getByText('நிலா')).toBeInTheDocument();
  });
});

describe('the second click deletes', () => {
  it('sends the DELETE and drops the row', async () => {
    render(<LexiconManager initial={[ROW]} />);
    fireEvent.click(deleteButton());
    await act(async () => { fireEvent.click(armedButton()); });

    const calls = deleteCalls();
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain('/api/admin/lexicon/lex_1');
    expect(screen.queryByText('நிலா')).toBeNull();
  });
});

describe('it disarms rather than lying in wait', () => {
  it('a button left armed goes back to Delete', () => {
    jest.useFakeTimers();
    try {
      render(<LexiconManager initial={[ROW]} />);
      fireEvent.click(deleteButton());
      expect(armedButton()).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(6000); });

      // Back to its resting state: a later stray click cannot land on a
      // confirmation armed minutes ago.
      expect(deleteButton()).toHaveTextContent('Delete');
      expect(deleteCalls()).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  /** Arming row B must not leave row A armed — two live confirmations is worse
      than none, because the operator stops reading them. */
  it('only one row can be armed at a time', () => {
    const rows = [ROW, { ...ROW, id: 'lex_2', word: 'கடல்' }];
    render(<LexiconManager initial={rows} />);

    fireEvent.click(screen.getByRole('button', { name: /^Delete நிலா$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Delete கடல்$/ }));

    expect(screen.getByRole('button', { name: /^Delete நிலா$/ })).toHaveTextContent('Delete');
    expect(screen.getByRole('button', { name: /Confirm deleting கடல்/ })).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });
});

describe('a refusal says why', () => {
  it("shows the server's own reason instead of a flat 'Delete failed'", async () => {
    mockFetch({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Bad id' }),
    });
    render(<LexiconManager initial={[ROW]} />);
    fireEvent.click(deleteButton());
    await act(async () => { fireEvent.click(armedButton()); });

    expect(toastError).toHaveBeenCalledWith('Bad id');
    // The row survives a failed delete.
    expect(screen.getByText('நிலா')).toBeInTheDocument();
  });

  it('falls back to the status code when the body carries no reason', async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({}) });
    render(<LexiconManager initial={[ROW]} />);
    fireEvent.click(deleteButton());
    await act(async () => { fireEvent.click(armedButton()); });

    expect(toastError).toHaveBeenCalledWith('Delete failed (500)');
  });
});
