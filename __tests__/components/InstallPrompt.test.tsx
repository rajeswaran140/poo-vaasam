import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

const realUA = window.navigator.userAgent;

function setUA(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

/** Fire a beforeinstallprompt carrying a capturable prompt() (Android/Chromium). */
function fireBeforeInstall() {
  const prompt = jest.fn().mockResolvedValue(undefined);
  const ev = new Event('beforeinstallprompt') as Event & {
    prompt: jest.Mock;
    userChoice: Promise<{ outcome: string }>;
  };
  ev.prompt = prompt;
  ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => {
    window.dispatchEvent(ev);
  });
  return prompt;
}

beforeEach(() => {
  localStorage.clear();
  setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120');
});
afterAll(() => setUA(realUA));

describe('InstallPrompt', () => {
  it('stays hidden until the browser signals installability', () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole('region', { name: /install tamilagaval/i })).toBeNull();
  });

  it('appears with an install button once beforeinstallprompt fires (Android)', () => {
    render(<InstallPrompt />);
    fireBeforeInstall();
    expect(screen.getByRole('region', { name: /install tamilagaval/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'நிறுவு' })).toBeInTheDocument();
  });

  it('triggers the native prompt and remembers dismissal when installed', async () => {
    render(<InstallPrompt />);
    const prompt = fireBeforeInstall();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'நிறுவு' }));
    });
    expect(prompt).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /install tamilagaval/i })).toBeNull()
    );
    expect(localStorage.getItem('tamilagaval:pwa-install-dismissed:v1')).toBe('1');
  });

  it('shows manual Add-to-Home-Screen instructions on iOS (no install button)', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari');
    render(<InstallPrompt />);
    expect(screen.getByRole('region', { name: /install tamilagaval/i })).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'நிறுவு' })).toBeNull();
  });

  it('can be dismissed, and does not return on the next render', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari');
    const { unmount } = render(<InstallPrompt />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }));
    expect(screen.queryByRole('region', { name: /install tamilagaval/i })).toBeNull();
    expect(localStorage.getItem('tamilagaval:pwa-install-dismissed:v1')).toBe('1');

    unmount();
    render(<InstallPrompt />);
    expect(screen.queryByRole('region', { name: /install tamilagaval/i })).toBeNull();
  });
});
