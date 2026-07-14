/**
 * @jest-environment jsdom
 *
 * The WhatsApp referral-coefficient panel — the KPI that says whether a share
 * actually brought anyone back. Covers: not-configured, happy path, the merged
 * WhatsApp labels, window switching, error, and the empty case.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReferralCoefficientPanel } from '@/components/admin/ReferralCoefficientPanel';

const mockAdminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => mockAdminFetch(...a) }));

const payload = {
  success: true,
  windowDays: 28,
  channelViews: 213_046,
  whatsappViews: 2600,
  externalViews: 2646,
  whatsappPer1k: 12.2,
  whatsappShareOfExternal: 98.3,
  sources: [
    { source: 'WhatsApp', views: 1578, estimatedMinutesWatched: 3000, isWhatsApp: true },
    { source: 'whatsapp.com', views: 958, estimatedMinutesWatched: 1800, isWhatsApp: true },
    { source: 'facebook.com', views: 26, estimatedMinutesWatched: 40, isWhatsApp: false },
  ],
};

const ok = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => {
  mockAdminFetch.mockReset().mockResolvedValue(ok(payload));
});

it('prompts to connect Analytics when OAuth is not configured, and fetches nothing', () => {
  render(<ReferralCoefficientPanel ytaConfigured={false} />);
  expect(screen.getByText(/Connect YouTube Analytics/i)).toBeInTheDocument();
  expect(mockAdminFetch).not.toHaveBeenCalled();
});

it('shows the coefficient as the headline number', async () => {
  render(<ReferralCoefficientPanel ytaConfigured />);
  expect(await screen.findByText('12.2')).toBeInTheDocument();
  expect(screen.getByText(/WhatsApp views \/ 1k/i)).toBeInTheDocument();
});

it('shows the denominator so the ratio cannot be misread', async () => {
  render(<ReferralCoefficientPanel ytaConfigured />);
  expect(await screen.findByText('213,046')).toBeInTheDocument();
  expect(screen.getByText(/channel views \(denominator\)/i)).toBeInTheDocument();
});

it('lists every external source and marks which ones the coefficient counts', async () => {
  render(<ReferralCoefficientPanel ytaConfigured />);
  expect(await screen.findByText('whatsapp.com')).toBeInTheDocument();
  expect(screen.getByText('facebook.com')).toBeInTheDocument();
  // Both WhatsApp-labelled rows are marked "counted"; facebook.com is not — so
  // the label merge is visible in the UI, not just arithmetic in the total.
  expect(screen.getAllByText('counted')).toHaveLength(2);
});

it('defaults to a 28-day window and can switch windows', async () => {
  const user = userEvent.setup();
  render(<ReferralCoefficientPanel ytaConfigured />);
  await waitFor(() => expect(mockAdminFetch).toHaveBeenCalledWith('/api/admin/youtube/referrals?days=28'));

  await user.click(screen.getByRole('button', { name: '7d' }));
  await waitFor(() => expect(mockAdminFetch).toHaveBeenCalledWith('/api/admin/youtube/referrals?days=7'));
});

it('surfaces an upstream error instead of rendering a misleading zero', async () => {
  mockAdminFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ success: false, error: 'Analytics API 429' }) });
  render(<ReferralCoefficientPanel ytaConfigured />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Analytics API 429');
  expect(screen.queryByText(/WhatsApp views \/ 1k/i)).not.toBeInTheDocument();
});

it('handles a window with no external referrals', async () => {
  mockAdminFetch.mockResolvedValue(
    ok({ ...payload, whatsappViews: 0, externalViews: 0, whatsappPer1k: 0, whatsappShareOfExternal: 0, sources: [] })
  );
  render(<ReferralCoefficientPanel ytaConfigured />);
  expect(await screen.findByText(/No external referrals recorded/i)).toBeInTheDocument();
});
