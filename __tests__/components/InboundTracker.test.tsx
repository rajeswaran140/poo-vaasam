import { render } from '@testing-library/react';
import { InboundTracker } from '@/components/analytics/InboundTracker';

const mockTrackInbound = jest.fn();
jest.mock('@/lib/analytics-events', () => ({ trackInbound: (...a: unknown[]) => mockTrackInbound(...a) }));

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
    expect(mockTrackInbound).toHaveBeenCalledWith('whatsapp', undefined);
  });

  it('lower-cases the source', () => {
    setSearch('?utm_source=WhatsApp');
    render(<InboundTracker />);
    expect(mockTrackInbound).toHaveBeenCalledWith('whatsapp', undefined);
  });

  it('forwards the source song id from utm_content (Status-share attribution)', () => {
    setSearch('?utm_source=whatsapp&utm_medium=whatsapp_status&utm_content=cnt_9');
    render(<InboundTracker />);
    expect(mockTrackInbound).toHaveBeenCalledWith('whatsapp', 'cnt_9');
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
