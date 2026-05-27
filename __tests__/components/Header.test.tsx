jest.mock('next/navigation', () => ({ usePathname: () => '/songs' }));

import { render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/Header';

afterEach(() => {
  document.body.style.overflow = '';
});

describe('Header — mobile menu', () => {
  it('toggles the mobile menu open and closed', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('#mobile-menu')).toBeNull();

    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(container.querySelector('#mobile-menu')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });

  it('locks background scroll while open and restores it on close', () => {
    render(<Header />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    const { container } = render(<Header />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(container.querySelector('#mobile-menu')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });
});

describe('Header — navigation', () => {
  it('marks the current route as active (aria-current)', () => {
    render(<Header />);
    const songLinks = screen.getAllByRole('link', { name: 'பாடல்கள்' });
    expect(songLinks.some((a) => a.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('groups content types under the படைப்புகள் dropdown trigger', () => {
    render(<Header />);
    expect(screen.getByRole('button', { name: /படைப்புகள்/ })).toBeInTheDocument();
  });
});
