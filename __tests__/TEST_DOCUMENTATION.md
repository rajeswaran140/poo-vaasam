# Test Suite Documentation

## Overview

Comprehensive test suite for the Tamil Content Platform (தமிழகவல்) admin portal covering API endpoints, UI components, and E2E workflows.

## Test Coverage Summary

- **Unit Tests:** 33 test cases across 3 API endpoint files
- **E2E Tests:** 20+ test cases for admin portal workflows  
- **Coverage Target:** 70% (branches, functions, lines, statements)

## Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# All tests
npm run test:all

# With coverage
npm run test:coverage
```

## Test Files Created

1. `__tests__/api/categories.test.ts` - 11 tests for Categories API
2. `__tests__/api/tags.test.ts` - 11 tests for Tags API  
3. `__tests__/api/admin-content.test.ts` - 11 tests for Admin Content API
4. `tests/e2e/admin-portal.spec.ts` - 20+ E2E tests for admin workflows

See individual test files for detailed test case descriptions.
