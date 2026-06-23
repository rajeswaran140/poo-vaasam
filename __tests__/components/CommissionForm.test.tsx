import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommissionForm } from '@/components/CommissionForm';
import { COMMISSION_SUBJECT } from '@/lib/commission';

describe('CommissionForm', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not call the API when required fields are empty (native validation blocks it)', async () => {
    const user = userEvent.setup();
    render(<CommissionForm />);
    await user.click(screen.getByRole('button', { name: /send request/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a structured brief to /api/contact with the commission subject', async () => {
    const user = userEvent.setup();
    render(<CommissionForm />);

    await user.type(screen.getByLabelText(/Name/i), 'Anbu');
    await user.type(screen.getByLabelText(/Email/i), 'anbu@example.com');
    await user.type(screen.getByLabelText(/Lyrics \/ details/i), 'காதல் வரிகள்');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/contact');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body).toMatchObject({ name: 'Anbu', email: 'anbu@example.com', subject: COMMISSION_SUBJECT });
    expect(body.message).toContain('🎼 Music Composition Request');
    expect(body.message).toContain('காதல் வரிகள்');

    // success state replaces the form
    await waitFor(() => expect(screen.getByText(/கோரிக்கை பெறப்பட்டது/)).toBeInTheDocument());
  });

  it('offers a WhatsApp hand-off pre-filled with the brief', async () => {
    const user = userEvent.setup();
    render(<CommissionForm />);
    await user.type(screen.getByLabelText(/Name/i), 'Anbu');
    await user.type(screen.getByLabelText(/Lyrics \/ details/i), 'test lyrics');
    const wa = screen.getByRole('link', { name: /whatsapp/i });
    expect(wa).toHaveAttribute('href', expect.stringContaining('wa.me/'));
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain('Music Composition Request');
  });

  it('shows an error (and does not crash) when the API call fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response);
    const user = userEvent.setup();
    render(<CommissionForm />);
    await user.type(screen.getByLabelText(/Name/i), 'A');
    await user.type(screen.getByLabelText(/Email/i), 'a@b.com');
    await user.type(screen.getByLabelText(/Lyrics \/ details/i), 'x');
    await user.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/try whatsapp/i));
  });
});
