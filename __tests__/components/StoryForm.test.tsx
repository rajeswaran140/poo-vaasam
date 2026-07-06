import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StoryForm from '@/components/StoryForm';

describe('StoryForm', () => {
  beforeEach(() => {
    (global.fetch as unknown) = jest.fn();
  });

  it('renders the theme select, name, story, email, consent and submit', () => {
    render(<StoryForm />);
    expect(screen.getByLabelText(/உங்கள் பெயர்/)).toBeInTheDocument();
    expect(screen.getByLabelText(/கருப்பொருள்/)).toBeInTheDocument();
    expect(screen.getByLabelText(/நினைவு/)).toBeInTheDocument();
    expect(screen.getByLabelText(/மின்னஞ்சல்/)).toBeInTheDocument();
    expect(screen.getByLabelText(/feature my story/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /பகிருங்கள்/ })).toBeInTheDocument();
  });

  it('uses the RESPECTFUL register in the submit CTA (பகிருங்கள், not பகிர்)', () => {
    render(<StoryForm />);
    const btn = screen.getByRole('button', { name: /பகிருங்கள்/ });
    expect(btn.textContent).toContain('பகிருங்கள்');
  });

  it('posts the theme/name/story/consent payload to /api/stories and shows a Tamil thank-you', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'உங்கள் கதைக்கு நன்றி!' }),
    });

    const user = userEvent.setup();
    render(<StoryForm />);

    await user.type(screen.getByLabelText(/உங்கள் பெயர்/), 'Test Fan');
    await user.selectOptions(screen.getByLabelText(/கருப்பொருள்/), 'homeland');
    await user.type(screen.getByLabelText(/நினைவு/), 'This song reminds me of home.');
    await user.type(screen.getByLabelText(/மின்னஞ்சல்/), 'fan@example.com');
    await user.click(screen.getByLabelText(/feature my story/i));
    await user.click(screen.getByRole('button', { name: /பகிருங்கள்/ }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/stories', expect.objectContaining({ method: 'POST' }))
    );

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({
      name: 'Test Fan',
      theme: 'homeland',
      story: 'This song reminds me of home.',
      email: 'fan@example.com',
      featureConsent: true,
      company: '',
    });
    expect(await screen.findByText(/நன்றி/)).toBeInTheDocument();
  });

  it('keeps the honeypot empty on a normal submission', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const user = userEvent.setup();
    render(<StoryForm />);
    await user.type(screen.getByLabelText(/உங்கள் பெயர்/), 'Fan');
    await user.type(screen.getByLabelText(/நினைவு/), 'A memory long enough.');
    await user.click(screen.getByRole('button', { name: /பகிருங்கள்/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.company).toBe('');
  });

  it('shows an error alert when the API rejects', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'Validation failed' }) });
    const user = userEvent.setup();
    render(<StoryForm />);
    await user.type(screen.getByLabelText(/உங்கள் பெயர்/), 'Fan');
    await user.type(screen.getByLabelText(/நினைவு/), 'short');
    await user.click(screen.getByRole('button', { name: /பகிருங்கள்/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
