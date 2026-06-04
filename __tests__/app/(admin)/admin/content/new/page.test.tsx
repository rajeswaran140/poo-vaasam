/**
 * New Content Page tests.
 *
 * Covers the two regressions found in the /admin/content/new audit:
 *  1. Categories & tags must load via adminFetch (fresh Bearer token), and a
 *     load failure must surface an actionable message — not an endless "Loading…".
 *  2. The numeric audioDuration input must be submitted as a NUMBER, not the
 *     raw string a number input emits (which 400s the create).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewContentPage from '@/app/(admin)/admin/content/new/page';
import { adminFetch } from '@/lib/client-auth';

// adminFetch is the single network seam — mock it and the page has no real deps.
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));
// MediaUploadField pulls in upload plumbing we don't exercise here.
jest.mock('@/components/admin/MediaUploadField', () => ({
  MediaUploadField: () => <div data-testid="media-upload" />,
}));
// TamilInput → a plain input so we can drive title/body/author by label.
jest.mock('@/components/admin/TamilInput', () => ({
  TamilInput: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
// Any lucide icon → a no-op component.
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));

const mockAdminFetch = adminFetch as jest.Mock;

const jsonRes = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

beforeEach(() => {
  mockAdminFetch.mockReset();
});

describe('NewContentPage — taxonomy loading', () => {
  it('loads categories and tags via adminFetch (Bearer), not a cookie-only fetch', async () => {
    mockAdminFetch.mockImplementation((url: string) => {
      if (url === '/api/categories') return Promise.resolve(jsonRes({ success: true, data: [{ id: 'c1', name: 'Mother' }] }));
      if (url === '/api/tags') return Promise.resolve(jsonRes({ success: true, data: [{ id: 't1', name: 'love' }] }));
      return Promise.resolve(jsonRes({ success: false }, false, 500));
    });

    render(<NewContentPage />);

    expect(await screen.findByText('Mother')).toBeInTheDocument();
    expect(screen.getByText('#love')).toBeInTheDocument();
    expect(mockAdminFetch).toHaveBeenCalledWith('/api/categories');
    expect(mockAdminFetch).toHaveBeenCalledWith('/api/tags');
  });

  it('shows an actionable message (not endless "Loading…") when the load 401s', async () => {
    mockAdminFetch.mockResolvedValue(jsonRes({ success: false }, false, 401));

    render(<NewContentPage />);

    expect(await screen.findByText(/Could not load categories/i)).toBeInTheDocument();
    expect(screen.getByText(/Could not load tags/i)).toBeInTheDocument();
    expect(screen.queryByText('Loading categories...')).not.toBeInTheDocument();
  });
});

describe('NewContentPage — audioDuration coercion', () => {
  it('submits a numeric audioDuration (the number input string is coerced)', async () => {
    mockAdminFetch.mockImplementation((url: string) => {
      if (url === '/api/categories' || url === '/api/tags') return Promise.resolve(jsonRes({ success: true, data: [] }));
      // POST /api/admin/content
      return Promise.resolve(jsonRes({ success: true, data: { id: 'x' } }, true, 201));
    });

    render(<NewContentPage />);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Test Song' } });
    fireEvent.change(screen.getByLabelText(/^Content/), { target: { value: 'Some lyrics' } });
    fireEvent.change(screen.getByLabelText(/^Author/), { target: { value: 'Raj' } });
    // The duration input emits a STRING ("210"); the page must store it as a number.
    fireEvent.change(screen.getByPlaceholderText('180'), { target: { value: '210' } });

    fireEvent.click(screen.getByRole('button', { name: /create content/i }));

    await waitFor(() => {
      const postCall = mockAdminFetch.mock.calls.find((c) => c[0] === '/api/admin/content');
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall![1].body);
      expect(body.audioDuration).toBe(210);
      expect(typeof body.audioDuration).toBe('number');
    });
  });
});
