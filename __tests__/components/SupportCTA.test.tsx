import { render, screen } from '@testing-library/react';

// Force the channel to be "configured" so the CTA renders; keep the rest of
// config/site real (youtubeSubscribeUrl, SITE.youtube.channelUrl…).
jest.mock('@/config/site', () => ({
  ...jest.requireActual('@/config/site'),
  isYouTubeChannelConfigured: jest.fn(() => true),
}));

import { SupportCTA } from '@/components/SupportCTA';
import { SITE, youtubeSubscribeUrl } from '@/config/site';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

describe('SupportCTA', () => {
  it('renders a UTM-tagged Subscribe link (sub_confirmation + call-site source)', () => {
    render(<SupportCTA source="lyrics-unlock" />);
    const sub = screen.getByLabelText('Subscribe on YouTube');
    expect(sub).toHaveAttribute('href', youtubeSubscribeUrl('lyrics-unlock'));
    expect(sub.getAttribute('href')).toContain('sub_confirmation=1');
    expect(sub.getAttribute('href')).toContain('utm_content=lyrics-unlock');
  });

  it('renders a Super Thanks link pointing at the channel', () => {
    render(<SupportCTA source="support-page" />);
    expect(screen.getByLabelText('Send a Super Thanks on YouTube')).toHaveAttribute(
      'href',
      SITE.youtube.channelUrl
    );
  });

  it('shows the support heading', () => {
    render(<SupportCTA source="x" />);
    expect(screen.getByText(/Support Tamilagaval/)).toBeInTheDocument();
  });

  it('renders nothing when the channel is not configured', () => {
    const site = jest.requireMock('@/config/site') as { isYouTubeChannelConfigured: jest.Mock };
    site.isYouTubeChannelConfigured.mockReturnValueOnce(false);
    const { container } = render(<SupportCTA source="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});
