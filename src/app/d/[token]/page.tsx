/**
 * /d/[token] — what a buyer opens.
 *
 * Renders and counts NOTHING. Email security filters prefetch links in a
 * message; if this route redirected to the file, a scanner would consume a
 * download before the buyer clicked, possibly all of them through several
 * filters. The Download button is what counts, via /api/d/[token].
 */
import Link from 'next/link';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { isDeliveryToken, deliveryStatusOf } from '@/types/delivery';

export const dynamic = 'force-dynamic';

const MB = 1024 * 1024;

const MESSAGES: Record<string, string> = {
  invalid: 'This link is not valid.',
  expired: 'This link has expired. Contact TamilAgaval for a new one.',
  exhausted: 'This link has already been used.',
  revoked: 'This link is no longer active.',
};

export default async function DeliveryPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e } = await searchParams;

  const delivery = isDeliveryToken(token) ? await new DeliveryRepository().findByToken(token) : null;
  const status = delivery ? deliveryStatusOf(delivery) : 'invalid';
  const problem = status !== 'active' ? MESSAGES[status] ?? MESSAGES.invalid : e ? MESSAGES[e] : null;

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold text-gray-900">TamilAgaval</h1>

      {problem || !delivery ? (
        <p className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6 text-gray-700">
          {problem ?? MESSAGES.invalid}
        </p>
      ) : (
        <div className="mt-6 rounded-lg border border-gray-200 p-6">
          <p className="font-medium text-gray-900">{delivery.filename}</p>
          <p className="mt-1 text-sm text-gray-500">
            {(delivery.contentLength / MB).toFixed(1)} MB ·{' '}
            {delivery.maxDownloads - delivery.downloadCount} download
            {delivery.maxDownloads - delivery.downloadCount === 1 ? '' : 's'} remaining ·
            expires {delivery.expiresAt.slice(0, 10)}
          </p>
          <Link
            href={`/api/d/${token}`}
            prefetch={false}
            className="mt-5 inline-block rounded-lg bg-orange-600 px-5 py-2.5 font-medium text-white hover:bg-orange-700"
          >
            Download
          </Link>
        </div>
      )}
    </main>
  );
}
