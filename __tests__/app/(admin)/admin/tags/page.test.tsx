/** @jest-environment jsdom */
/**
 * TagsPage tests — covers the audit fixes: tags load/create/delete go through
 * adminFetch (fresh Bearer + 401 recovery), a failed load shows an error
 * (not a misleading "No tags yet"), create trims + posts via adminFetch, and
 * delete fires a DELETE via adminFetch.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TagsPage from '@/app/(admin)/admin/tags/page';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));
// Reduce the confirm dialog to a single confirm button when open.
jest.mock('@/components/ui/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button onClick={onConfirm}>__confirm-delete__</button> : null,
}));

const mockAdminFetch = adminFetch as jest.Mock;
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

beforeEach(() => mockAdminFetch.mockReset());

it('loads tags via adminFetch and renders them', async () => {
  mockAdminFetch.mockResolvedValueOnce(
    jsonRes({ success: true, data: [{ id: 't1', name: 'காதல்', slug: 'love', contentCount: 3 }] })
  );
  render(<TagsPage />);

  expect(await screen.findByText('#காதல்')).toBeInTheDocument();
  expect(mockAdminFetch).toHaveBeenCalledWith('/api/tags');
});

it('shows an error state (not a false "No tags yet") when the load 401s', async () => {
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: false }, false, 401));
  render(<TagsPage />);

  expect(await screen.findByText(/Could not load tags/i)).toBeInTheDocument();
  expect(screen.queryByText(/No tags yet/i)).not.toBeInTheDocument();
});

it('creates a tag via adminFetch with a trimmed name', async () => {
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: [] })); // initial load
  render(<TagsPage />);
  await screen.findByText(/No tags yet/i);

  fireEvent.click(screen.getByRole('button', { name: '+ New Tag' }));
  fireEvent.change(screen.getByPlaceholderText('காதல்'), { target: { value: '  புது  ' } });

  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: { id: 't2' } }, true, 201)); // create
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: [] })); // reload
  fireEvent.click(screen.getByRole('button', { name: /create tag/i }));

  await waitFor(() => {
    const post = mockAdminFetch.mock.calls.find((c) => c[0] === '/api/tags' && c[1]?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post![1].body)).toEqual({ name: 'புது' });
  });
});

it('deletes a tag via adminFetch DELETE with the tag id', async () => {
  mockAdminFetch.mockResolvedValueOnce(
    jsonRes({ success: true, data: [{ id: 't1', name: 'காதல்', slug: 'love', contentCount: 0 }] })
  );
  render(<TagsPage />);
  await screen.findByText('#காதல்');

  fireEvent.click(screen.getByTitle('Delete tag')); // opens the confirm modal
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true })); // delete
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: [] })); // reload
  fireEvent.click(screen.getByText('__confirm-delete__'));

  await waitFor(() => {
    const del = mockAdminFetch.mock.calls.find(
      (c) => String(c[0]).startsWith('/api/tags?id=') && c[1]?.method === 'DELETE'
    );
    expect(del).toBeTruthy();
    expect(String(del![0])).toContain('id=t1');
  });
});
