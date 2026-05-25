import { render, screen } from '@testing-library/react';
import MusicCompositionPage from '@/app/music-composition/page';

describe('Music Composition page', () => {
  it('renders the H1 service heading', () => {
    render(<MusicCompositionPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /இசையமைப்பு சேவை/ })
    ).toBeInTheDocument();
  });

  it('has order CTAs that link to the contact form with a prefilled subject', () => {
    render(<MusicCompositionPage />);
    const links = screen.getAllByRole('link');
    const orderLink = links.find(
      (a) => a.getAttribute('href') === '/contact?subject=Music%20Composition%20Request'
    );
    expect(orderLink).toBeDefined();
  });

  it('renders FAQ questions', () => {
    render(<MusicCompositionPage />);
    expect(screen.getByText('விலை எவ்வளவு?')).toBeInTheDocument();
    expect(screen.getByText(/எப்படி ஆர்டர்/)).toBeInTheDocument();
  });
});
