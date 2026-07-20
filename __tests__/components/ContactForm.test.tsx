import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactForm from '@/components/ContactForm';

// Tamil copy the component renders (kept here so the tests assert the exact,
// respectful strings users see rather than an English placeholder).
const T = {
  nameRequired: 'உங்கள் பெயரை உள்ளிடுங்கள்.',
  emailRequired: 'மின்னஞ்சல் முகவரியை உள்ளிடுங்கள்.',
  emailInvalid: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடுங்கள்.',
  messageRequired: 'செய்தியை உள்ளிடுங்கள்.',
  success: 'உங்கள் செய்தி அனுப்பப்பட்டது. நன்றி!',
};

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

  it('mirrors the server length caps as maxLength attributes', () => {
    render(<ContactForm />);
    expect(screen.getByLabelText(/Name/i)).toHaveAttribute('maxlength', '100');
    expect(screen.getByLabelText(/Email/i)).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText(/Subject/i)).toHaveAttribute('maxlength', '150');
    expect(screen.getByLabelText(/Message/i)).toHaveAttribute('maxlength', '5000');
  });

  it('posts the form data to /api/contact and shows a Tamil success message', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 201,
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
    expect(await screen.findByText(T.success)).toBeInTheDocument();
  });

  it('blocks submit and shows accessible, focused field errors when required fields are empty', async () => {
    const user = userEvent.setup();
    render(<ContactForm />);

    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    // Never reaches the network — client validation stops it.
    expect(global.fetch).not.toHaveBeenCalled();

    // Each required field shows its Tamil error.
    expect(screen.getByText(T.nameRequired)).toBeInTheDocument();
    expect(screen.getByText(T.emailRequired)).toBeInTheDocument();
    expect(screen.getByText(T.messageRequired)).toBeInTheDocument();

    // First invalid field is marked and focused for keyboard/SR users.
    const name = screen.getByLabelText(/Name/i);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'name-error');
    expect(name).toHaveFocus();
  });

  it('rejects a malformed email client-side without hitting the API', async () => {
    const user = userEvent.setup();
    render(<ContactForm />);

    await user.type(screen.getByLabelText(/Name/i), 'Raj');
    await user.type(screen.getByLabelText(/Email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/Message/i), 'Hi there');
    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(T.emailInvalid)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toHaveFocus();
  });

  it('clears a field error as soon as the user edits that field', async () => {
    const user = userEvent.setup();
    render(<ContactForm />);

    await user.click(screen.getByRole('button', { name: /Send Message/i }));
    expect(screen.getByText(T.nameRequired)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Name/i), 'Raj');
    expect(screen.queryByText(T.nameRequired)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Name/i)).not.toHaveAttribute('aria-invalid');
  });

  it('shows a Tamil rate-limit message on HTTP 429', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ success: false, error: 'Too many requests. Please slow down.' }),
    });

    const user = userEvent.setup();
    render(<ContactForm />);
    await user.type(screen.getByLabelText(/Name/i), 'Raj');
    await user.type(screen.getByLabelText(/Email/i), 'raj@example.com');
    await user.type(screen.getByLabelText(/Message/i), 'Hello');
    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(await screen.findByText(/அதிக முயற்சிகள்/)).toBeInTheDocument();
  });

  it('maps a server-side 400 field error back onto the field', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: 'Validation failed',
        errors: { email: ['A valid email is required'] },
      }),
    });

    const user = userEvent.setup();
    render(<ContactForm />);
    await user.type(screen.getByLabelText(/Name/i), 'Raj');
    await user.type(screen.getByLabelText(/Email/i), 'raj@example.com'); // passes client, server rejects
    await user.type(screen.getByLabelText(/Message/i), 'Hello');
    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(await screen.findByText(T.emailInvalid)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a Tamil network-error message when the request throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

    const user = userEvent.setup();
    render(<ContactForm />);
    await user.type(screen.getByLabelText(/Name/i), 'Raj');
    await user.type(screen.getByLabelText(/Email/i), 'raj@example.com');
    await user.type(screen.getByLabelText(/Message/i), 'Hello');
    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(await screen.findByText(/இணைய இணைப்பில் சிக்கல்/)).toBeInTheDocument();
  });
});
