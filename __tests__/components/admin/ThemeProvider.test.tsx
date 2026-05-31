/** @jest-environment jsdom */
/**
 * Unit tests for ThemeProvider / useAdminTheme — verifies the dark class
 * lands on the wrapper element, the toggle flips state, and the choice
 * persists to localStorage.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useAdminTheme } from '@/components/admin/ThemeProvider';

function Probe() {
  const { theme, toggle, setTheme } = useAdminTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggle}>toggle</button>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={() => setTheme('light')}>set-light</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  // Default matchMedia: not a dark-mode user.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({ matches: false, media: '', addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })),
  });
});

it('defaults to light when no saved preference and system is light', async () => {
  const { container } = render(<ThemeProvider><Probe /></ThemeProvider>);
  // useEffect hydrates after mount — flush it.
  await act(async () => {});
  expect(screen.getByTestId('theme').textContent).toBe('light');
  expect(container.firstChild).not.toHaveClass('dark');
});

it('honours system preference on first visit (no saved value)', async () => {
  (window.matchMedia as jest.Mock).mockImplementation(() => ({ matches: true, media: '', addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() }));
  const { container } = render(<ThemeProvider><Probe /></ThemeProvider>);
  await act(async () => {});
  expect(screen.getByTestId('theme').textContent).toBe('dark');
  expect(container.firstChild).toHaveClass('dark');
});

it('reads saved theme from localStorage on mount', async () => {
  localStorage.setItem('tamilagaval:admin-theme', 'dark');
  const { container } = render(<ThemeProvider><Probe /></ThemeProvider>);
  await act(async () => {});
  expect(screen.getByTestId('theme').textContent).toBe('dark');
  expect(container.firstChild).toHaveClass('dark');
});

it('toggle flips state and persists', async () => {
  const { container } = render(<ThemeProvider><Probe /></ThemeProvider>);
  await act(async () => {});

  fireEvent.click(screen.getByText('toggle'));
  expect(screen.getByTestId('theme').textContent).toBe('dark');
  expect(container.firstChild).toHaveClass('dark');
  expect(localStorage.getItem('tamilagaval:admin-theme')).toBe('dark');

  fireEvent.click(screen.getByText('toggle'));
  expect(screen.getByTestId('theme').textContent).toBe('light');
  expect(container.firstChild).not.toHaveClass('dark');
  expect(localStorage.getItem('tamilagaval:admin-theme')).toBe('light');
});

it('setTheme(value) writes directly + persists', async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await act(async () => {});

  fireEvent.click(screen.getByText('set-dark'));
  expect(screen.getByTestId('theme').textContent).toBe('dark');
  expect(localStorage.getItem('tamilagaval:admin-theme')).toBe('dark');

  fireEvent.click(screen.getByText('set-light'));
  expect(screen.getByTestId('theme').textContent).toBe('light');
  expect(localStorage.getItem('tamilagaval:admin-theme')).toBe('light');
});

it('useAdminTheme outside a provider throws', () => {
  // suppress React's expected console.error noise
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<Probe />)).toThrow(/inside <ThemeProvider>/);
  spy.mockRestore();
});
