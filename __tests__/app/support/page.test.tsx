import { render, screen } from '@testing-library/react';

jest.mock('@/config/site', () => ({
  ...jest.requireActual('@/config/site'),
  isYouTubeChannelConfigured: jest.fn(() => true),
  isYouTubeVideosConfigured: jest.fn(() => true),
}));

import SupportPage, { metadata } from '@/app/support/page';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

describe('Support page', () => {
  it('renders the support H1', () => {
    render(<SupportPage />);
    expect(screen.getByRole('heading', { level: 1, name: /ஆதரியுங்கள்/ })).toBeInTheDocument();
  });

  it('offers the Subscribe + Super Thanks CTAs', () => {
    render(<SupportPage />);
    expect(screen.getByLabelText('Subscribe on YouTube')).toBeInTheDocument();
    expect(screen.getByLabelText('Send a Super Thanks on YouTube')).toBeInTheDocument();
  });

  it('links back to the songs so support flows into listening', () => {
    render(<SupportPage />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/songs');
  });
});

describe('Support page — metadata', () => {
  it('canonicalises on /support', () => {
    expect(metadata.alternates?.canonical).toBe('/support');
  });
});
