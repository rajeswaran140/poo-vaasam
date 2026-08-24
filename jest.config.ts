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
    // aws-amplify v5's Interactions module unconditionally drags in
    // @aws-sdk/client-lex-runtime-{service,v2}, whose transitive
    // @aws-sdk/middleware-user-agent 3.972+ ships ES-module `export` syntax
    // that jest's default transform can't parse. Nothing in TamilAgaval
    // actually uses Lex — stub these two modules to keep jest from touching
    // the offending chain. Root fix is aws-amplify v5 → v6 (per-category
    // entrypoints), which is a bigger PR.
    '^@aws-sdk/client-lex-runtime-service$': '<rootDir>/__mocks__/aws-sdk-lex-empty.js',
    '^@aws-sdk/client-lex-runtime-v2$': '<rootDir>/__mocks__/aws-sdk-lex-empty.js',
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
