import type { Config } from 'jest';
import nextJest from 'next/jest';

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // AWS SDK: force the Node builds under jsdom.
    //
    // From @aws-sdk/core 3.977 (pulled in by @aws-sdk/client-ssm) exactly two
    // packages publish a "browser" export condition -- @aws-sdk/core and
    // @smithy/core -- across the six subpaths enumerated below.
    // jest-environment-jsdom selects that condition, which is wrong here: these
    // suites exercise server code that talks to DynamoDB and SSM.
    //
    // The two packages fail differently, which is why both are needed:
    //   @aws-sdk/core -> dist-es/.../index.browser.js  (ESM)
    //        "SyntaxError: Unexpected token 'export'"
    //   @smithy/core  -> dist-cjs/.../index.browser.js (CJS, but the BROWSER
    //        implementation) -> parses, then "loadConfig is not a function"
    //
    // Redirecting is correct where transforming is not: the browser build's
    // shape is not what the CJS consumers expect, so compiling it merely moves
    // the failure to runtime. Changing customExportConditions globally would
    // alter resolution for every other dependency; this touches two.
    //
    // Subpaths are enumerated and anchored rather than matched with a wildcard,
    // so a subpath with no Node build cannot be silently rewritten to a file
    // that does not exist.
    '^@aws-sdk/core/(client|httpAuthSchemes)$':
      '<rootDir>/node_modules/@aws-sdk/core/dist-cjs/submodules/$1/index.js',
    '^@smithy/core/(serde|event-streams|endpoints|config)$':
      '<rootDir>/node_modules/@smithy/core/dist-cjs/submodules/$1/index.js',
  },
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/tests/',
    '/__tests__/e2e/',
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config);
