/** @jest-environment jsdom */
/**
 * CategoriesPage tests — covers the audit fixes: load/create/delete go through
 * adminFetch (fresh Bearer + 401 recovery), a failed load shows an error (not a
 * misleading "No categories yet"), create trims + posts via adminFetch and uses
 * a toast (not alert()), and the new delete affordance fires a DELETE.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CategoriesPage from '@/app/(admin)/admin/categories/page';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/components/ui/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button onClick={onConfirm}>__confirm-delete__</button> : null,
}));

const mockAdminFetch = adminFetch as jest.Mock;
const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

beforeEach(() => mockAdminFetch.mockReset());

it('loads categories via adminFetch and renders them', async () => {
  mockAdminFetch.mockResolvedValueOnce(
    jsonRes({ success: true, data: [{ id: 'c1', name: 'பாடல்கள்', slug: 'songs', description: 'd', contentCount: 5 }] })
  );
  render(<CategoriesPage />);

  expect(await screen.findByText('பாடல்கள்')).toBeInTheDocument();
  expect(mockAdminFetch).toHaveBeenCalledWith('/api/categories');
});

it('shows an error state (not a false "No categories yet") when the load 401s', async () => {
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: false }, false, 401));
  render(<CategoriesPage />);

  expect(await screen.findByText(/Could not load categories/i)).toBeInTheDocument();
  expect(screen.queryByText(/No categories yet/i)).not.toBeInTheDocument();
});

it('creates a category via adminFetch with a trimmed name', async () => {
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: [] })); // initial load
  render(<CategoriesPage />);
  await screen.findByText(/No categories yet/i);

  fireEvent.click(screen.getByRole('button', { name: '+ New Category' }));
  fireEvent.change(screen.getByPlaceholderText('தமிழ் பாடல்கள்'), { target: { value: '  புது வகை  ' } });

  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: { id: 'c2' } }, true, 201)); // create
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: [] })); // reload
  fireEvent.click(screen.getByRole('button', { name: /create category/i }));

  await waitFor(() => {
    const post = mockAdminFetch.mock.calls.find((c) => c[0] === '/api/categories' && c[1]?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post![1].body).name).toBe('புது வகை');
  });
});

it('deletes a category via adminFetch DELETE with the id', async () => {
  mockAdminFetch.mockResolvedValueOnce(
    jsonRes({ success: true, data: [{ id: 'c1', name: 'பாடல்கள்', slug: 'songs', description: '', contentCount: 0 }] })
  );
  render(<CategoriesPage />);
  await screen.findByText('பாடல்கள்');

  fireEvent.click(screen.getByTitle('Delete category')); // opens confirm modal
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true })); // delete
  mockAdminFetch.mockResolvedValueOnce(jsonRes({ success: true, data: [] })); // reload
  fireEvent.click(screen.getByText('__confirm-delete__'));

  await waitFor(() => {
    const del = mockAdminFetch.mock.calls.find(
      (c) => String(c[0]).startsWith('/api/categories?id=') && c[1]?.method === 'DELETE'
    );
    expect(del).toBeTruthy();
    expect(String(del![0])).toContain('id=c1');
  });
});
