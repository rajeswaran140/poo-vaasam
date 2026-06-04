/** @jest-environment jsdom */
/**
 * Tests for SubscribeForm — posts the email to /api/subscribe and shows an
 * inline confirmation on success.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubscribeForm } from '@/components/SubscribeForm';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('submits the email to /api/subscribe and confirms on success', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ success: true, message: 'நன்றி!' }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<SubscribeForm source="footer" />);
  fireEvent.change(screen.getByLabelText(/பெறுங்கள்/), { target: { value: 'raj@example.com' } });
  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/subscribe');
  const sent = JSON.parse(init.body);
  expect(sent.email).toBe('raj@example.com');
  expect(sent.source).toBe('footer');

  await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
});

it('shows an error and keeps the form when the request fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({ success: false, error: 'Subscription failed.' }),
  }) as unknown as typeof fetch;

  render(<SubscribeForm />);
  fireEvent.change(screen.getByLabelText(/பெறுங்கள்/), { target: { value: 'raj@example.com' } });
  fireEvent.click(screen.getByRole('button'));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Subscription failed.'));
  expect(screen.getByLabelText(/பெறுங்கள்/)).toBeInTheDocument(); // form still present
});
