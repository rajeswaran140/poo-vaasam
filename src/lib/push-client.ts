/**
 * Client-side web-push helpers. The service worker is registered LAZILY here —
 * only when a visitor opts in — so non-subscribers never get a worker.
 */

/** Convert a base64url VAPID public key to the Uint8Array PushManager wants. Pure. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Register the push service worker, request permission, subscribe, and return
 * the subscription JSON to POST to the server. Throws on denial/failure.
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if (!isPushSupported()) throw new Error('Push notifications are not supported on this browser.');
  if (!vapidPublicKey) throw new Error('Notifications are not configured.');

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));
  return sub.toJSON();
}
