/**
 * Idempotent GA4 property config for tamilagaval (run after the audit):
 *  - mark the site's real goals (subscribe_click, youtube_open) as Key Events
 *  - remove GA4's irrelevant default template conversions
 *  - raise event data retention from the 2-month default to 14 months
 *
 * Reads GA4_SERVICE_ACCOUNT_KEY (base64) + GA4_PROPERTY_ID. Needs the SA to have
 * Editor on the property (analytics.edit).
 */
import { JWT } from 'google-auth-library'

const sa = JSON.parse(Buffer.from(process.env.GA4_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'))
const P = process.env.GA4_PROPERTY_ID
const base = `https://analyticsadmin.googleapis.com/v1beta/properties/${P}`
const c = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/analytics.edit'] })

const ADD_KEY_EVENTS = ['subscribe_click', 'youtube_open']
const REMOVE_KEY_EVENTS = ['purchase', 'close_convert_lead', 'qualify_lead']

const list = (await c.request({ url: `${base}/keyEvents` })).data.keyEvents || []
const byName = Object.fromEntries(list.map((k) => [k.eventName, k.name]))

for (const ev of ADD_KEY_EVENTS) {
  if (byName[ev]) { console.log(`= keyEvent ${ev}: already set`); continue }
  try {
    await c.request({ url: `${base}/keyEvents`, method: 'POST', data: { eventName: ev, countingMethod: 'ONCE_PER_EVENT' } })
    console.log(`+ keyEvent ${ev}: CREATED`)
  } catch (e) { console.log(`x keyEvent ${ev}: ${e.response?.status} ${e.response?.data?.error?.message || e.message}`) }
}

for (const ev of REMOVE_KEY_EVENTS) {
  if (!byName[ev]) { console.log(`= keyEvent ${ev}: not present`); continue }
  try {
    await c.request({ url: `https://analyticsadmin.googleapis.com/v1beta/${byName[ev]}`, method: 'DELETE' })
    console.log(`- keyEvent ${ev}: REMOVED`)
  } catch (e) { console.log(`x keyEvent ${ev}: ${e.response?.status} ${e.response?.data?.error?.message || e.message}`) }
}

try {
  const r = await c.request({
    url: `${base}/dataRetentionSettings?updateMask=eventDataRetention`,
    method: 'PATCH', data: { eventDataRetention: 'FOURTEEN_MONTHS' },
  })
  console.log(`✓ data retention: ${r.data.eventDataRetention}`)
} catch (e) { console.log(`x retention: ${e.response?.status} ${e.response?.data?.error?.message || e.message}`) }
