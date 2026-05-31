/** @jest-environment jsdom */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '@/components/admin/ThemeProvider';
import { ThemeToggle } from '@/components/admin/ThemeToggle';

jest.mock('lucide-react', () => ({
  Sun: () => <svg data-testid="sun" />,
  Moon: () => <svg data-testid="moon" />,
}));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({ matches: false, media: '', addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn() })),
  });
});

it('renders the moon icon in light mode and switches to sun when toggled', async () => {
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
  await act(async () => {});

  expect(screen.getByTestId('moon')).toBeInTheDocument();
  expect(screen.queryByTestId('sun')).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Switch to dark theme'));
  await act(async () => {});

  expect(screen.getByTestId('sun')).toBeInTheDocument();
  expect(screen.queryByTestId('moon')).not.toBeInTheDocument();
});

it('aria-label flips to describe the next action', async () => {
  render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
  await act(async () => {});

  // In light mode the button offers to switch TO dark.
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button'));
  await act(async () => {});

  // In dark mode the button offers to switch TO light.
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
});
