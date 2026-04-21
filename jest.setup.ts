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
