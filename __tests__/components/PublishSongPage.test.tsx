import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mockAdminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => mockAdminFetch(...a) }));
jest.mock('@/lib/toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// Stub the upload + Tamil inputs as plain inputs so we can drive the form.
jest.mock('@/components/admin/MediaUploadField', () => ({
  MediaUploadField: ({ label, onChange }: { label: string; onChange: (u: string) => void }) => (
    <input aria-label={label} onChange={(e) => onChange(e.target.value)} />
  ),
}));
jest.mock('@/components/admin/TamilInput', () => ({
  TamilInput: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import PublishSongPage from '@/app/(admin)/admin/songs/publish/page';

beforeEach(() => jest.clearAllMocks());

const publishButton = () => screen.getByRole('button', { name: /Publish/ });

it('disables Publish until a title and audio are provided', () => {
  render(<PublishSongPage />);
  expect(publishButton()).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'புதிய பாடல்' } });
  expect(publishButton()).toBeDisabled(); // still no audio
  fireEvent.change(screen.getByLabelText(/Audio/), { target: { value: 'https://s3/a.wav' } });
  expect(publishButton()).toBeEnabled();
});

it('posts the publish payload and shows the result', async () => {
  mockAdminFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        id: 'cnt_x', audioDuration: 254, youtubeVideoId: 'aaaaaaaaaaa', matched: true,
        theme: 'mother', featuredImage: 'https://s3/c.png', deploy: { jobId: '181' },
      },
    }),
  });
  render(<PublishSongPage />);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'அம்மா பாடல்' } });
  fireEvent.change(screen.getByLabelText(/Audio/), { target: { value: 'https://s3/a.wav' } });
  await act(async () => {
    fireEvent.click(publishButton());
  });

  expect(mockAdminFetch).toHaveBeenCalledWith('/api/admin/songs/publish', expect.objectContaining({ method: 'POST' }));
  const body = JSON.parse(mockAdminFetch.mock.calls[0][1].body);
  expect(body).toMatchObject({ title: 'அம்மா பாடல்', audioUrl: 'https://s3/a.wav', generateCover: true, deploy: true });

  // The success panel renders (its "Go to songs" button is unique to it).
  await waitFor(() => expect(screen.getByRole('button', { name: 'Go to songs' })).toBeInTheDocument());
  expect(screen.getByText(/aaaaaaaaaaa \(auto-matched\)/)).toBeInTheDocument();
  expect(screen.getByText(/job 181 \(live/)).toBeInTheDocument();
});
