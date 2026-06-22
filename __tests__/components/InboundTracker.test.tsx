import { render } from '@testing-library/react';
import { InboundTracker } from '@/components/analytics/InboundTracker';

const mockTrackInbound = jest.fn();
jest.mock('@/lib/analytics-events', () => ({ trackInbound: (s: string) => mockTrackInbound(s) }));

function setSearch(search: string) {
  // history API updates window.location.search without redefining the
  // (non-configurable) jsdom location object.
  window.history.replaceState({}, '', search ? `/${search}` : '/');
}

describe('InboundTracker', () => {
  beforeEach(() => mockTrackInbound.mockClear());

  it('records an inbound visit when utm_source is a known channel (whatsapp)', () => {
    setSearch('?utm_source=whatsapp&utm_medium=share');
    render(<InboundTracker />);
    expect(mockTrackInbound).toHaveBeenCalledWith('whatsapp');
  });

  it('lower-cases the source', () => {
    setSearch('?utm_source=WhatsApp');
    render(<InboundTracker />);
    expect(mockTrackInbound).toHaveBeenCalledWith('whatsapp');
  });

  it('ignores an unknown / absent utm_source (no metric pollution)', () => {
    setSearch('?utm_source=randomblog');
    render(<InboundTracker />);
    setSearch('');
    render(<InboundTracker />);
    expect(mockTrackInbound).not.toHaveBeenCalled();
  });

  it('renders nothing', () => {
    setSearch('');
    const { container } = render(<InboundTracker />);
    expect(container).toBeEmptyDOMElement();
  });
});
