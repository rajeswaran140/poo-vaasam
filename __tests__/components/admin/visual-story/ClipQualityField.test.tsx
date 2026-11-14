/** The story's clip quality: 1080p (default) or 720p for every clip, saved at once. */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
import { adminFetch } from '@/lib/client-auth';
import { ClipQualityField } from '@/components/admin/visual-story/ClipQualityField';

const fetchMock = adminFetch as jest.Mock;
const ok = () => ({ ok: true, json: async () => ({ success: true }) });

beforeEach(() => fetchMock.mockReset());

it('shows the current quality with both prices', () => {
  render(<ClipQualityField vsId="vs_1" quality="1080p" onChanged={() => {}} />);
  const select = screen.getByLabelText('Clip quality') as HTMLSelectElement;
  expect(select.value).toBe('1080p');
  expect(screen.getByRole('option', { name: /1080p.*\$0\.25/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /720p.*\$0\.14/ })).toBeInTheDocument();
});

it('saves a change straight away and refreshes the story', async () => {
  fetchMock.mockResolvedValue(ok());
  const onChanged = jest.fn();
  render(<ClipQualityField vsId="vs_1" quality="1080p" onChanged={onChanged} />);
  fireEvent.change(screen.getByLabelText('Clip quality'), { target: { value: '720p' } });
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/admin/visual-story/vs_1');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ clipQuality: '720p' });
});

it('says so beside the control when the save fails', async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'That story no longer exists.' }) });
  render(<ClipQualityField vsId="vs_1" quality="1080p" onChanged={() => {}} />);
  fireEvent.change(screen.getByLabelText('Clip quality'), { target: { value: '720p' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('That story no longer exists.');
});
