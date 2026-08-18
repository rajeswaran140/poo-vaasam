// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock environment variables for tests
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_APP_NAME = 'Poo Vaasam';

// Polyfill for Next.js server components (Request, Response, etc.)
if (typeof Request === 'undefined') {
  global.Request = class Request {} as any;
}

if (typeof Response === 'undefined') {
  global.Response = class Response {} as any;
}

if (typeof Headers === 'undefined') {
  global.Headers = class Headers {} as any;
}

// jsdom doesn't implement scrollIntoView; stub it so components that call it
// (e.g. the songs list scrolling the active row into view) don't throw.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

/**
 * ⚠️ DEPLOYMENT CONFIG MUST NOT REACH THE TEST RUN.
 *
 * On 2026-08-17 `AUX_AI_ENGINE=openai` was set on the Amplify app to revive the
 * auxiliary AI layer (Anthropic out of credit, no Gemini key). The very next
 * build FAILED — `youtube-recommendations.test.ts` mocks the Anthropic client
 * and had silently depended on the engine defaulting to anthropic, which stopped
 * being true. Four tests failed, DEPLOY was cancelled, and PR #188 never shipped.
 *
 * A value changed in a console should never be able to break a build. Any test
 * that cares about the engine sets it explicitly; every other test starts from a
 * known-empty state.
 */
for (const key of ['AUX_AI_ENGINE', 'COMPOSER_ENGINE', 'CRITIC_ENGINE']) {
  delete process.env[key];
}
