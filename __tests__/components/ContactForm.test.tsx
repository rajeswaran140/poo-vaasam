import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactForm from '@/components/ContactForm';

describe('ContactForm', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/contact');
    (global.fetch as unknown) = jest.fn();
  });

  it('renders the core fields and submit button', () => {
    render(<ContactForm />);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Message/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Message/i })).toBeInTheDocument();
  });

  it('pre-fills the subject from the ?subject= query param', () => {
    window.history.replaceState({}, '', '/contact?subject=Music%20Composition%20Request');
    render(<ContactForm />);
    expect(screen.getByLabelText(/Subject/i)).toHaveValue('Music Composition Request');
  });

  it('posts the form data to /api/contact and shows a success message', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Your message has been sent. Thank you!' }),
    });

    const user = userEvent.setup();
    render(<ContactForm />);

    await user.type(screen.getByLabelText(/Name/i), 'Test User');
    await user.type(screen.getByLabelText(/Email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/Message/i), 'Hello there');
    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/contact', expect.objectContaining({ method: 'POST' }))
    );

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({ name: 'Test User', email: 'test@example.com', message: 'Hello there' });
    expect(await screen.findByText(/has been sent/i)).toBeInTheDocument();
  });
});
