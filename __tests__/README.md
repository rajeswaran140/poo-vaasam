# Testing Guide

This directory contains all tests for the Poo Vaasam application following Test-Driven Development (TDD) principles.

## 📁 Directory Structure

```
__tests__/
├── unit/              # Unit tests for functions, utilities, and components
│   ├── components/    # Component tests
│   ├── domain/        # Domain entity tests
│   ├── lib/          # Utility function tests
│   └── hooks/        # Custom hook tests
├── integration/       # Integration tests for APIs and database operations
│   ├── api/          # API route tests
│   └── database/     # Database operation tests
└── e2e/              # End-to-end tests with Playwright
    └── *.spec.ts     # E2E test files
```

## 🎯 Test-Driven Development (TDD) Workflow

### The Red-Green-Refactor Cycle

1. **RED**: Write a failing test first
   - Define what you want to achieve
   - Write test cases that describe the expected behavior
   - Run the test - it should fail (RED)

2. **GREEN**: Write minimal code to make the test pass
   - Implement just enough code to pass the test
   - Don't worry about optimization yet
   - Run the test - it should pass (GREEN)

3. **REFACTOR**: Improve the code
   - Clean up the implementation
   - Optimize performance
   - Ensure tests still pass

### Example TDD Workflow

```typescript
// 1. RED - Write the test first (it will fail)
test('should generate slug from Tamil text', () => {
  expect(generateSlug('பூ வாசம்')).toBe('பூ-வாசம்');
});

// 2. GREEN - Implement the function
export function generateSlug(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-');
}

// 3. REFACTOR - Improve the implementation
export function generateSlug(text: string, maxLength: number = 255): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\u0B80-\u0BFF\w\-]/g, '')
    .substring(0, maxLength);
}
```

## 🧪 Running Tests

### Unit Tests (Jest)

```bash
# Run all unit tests
npm run test

# Run tests in watch mode (for TDD)
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- slug.test.ts

# Run integration tests only
npm run test:integration
```

### E2E Tests (Playwright)

```bash
# Run E2E tests
npm run test:e2e

# Run E2E tests with UI mode
npm run test:e2e:ui

# Run specific E2E test
npx playwright test homepage.spec.ts

# Debug E2E test
npx playwright test --debug
```

### Run All Tests

```bash
npm run test:all
```

## 📝 Writing Tests

### Unit Tests

**Location**: `__tests__/unit/`

**Guidelines**:
- Test one thing at a time
- Use descriptive test names
- Follow AAA pattern: Arrange, Act, Assert
- Mock external dependencies
- Aim for 70%+ code coverage

**Example**:
```typescript
describe('ComponentName', () => {
  describe('Feature group', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### Integration Tests

**Location**: `__tests__/integration/`

**Guidelines**:
- Test interactions between modules
- Use real implementations (minimal mocking)
- Test API endpoints with actual requests
- Test database operations with test data

### E2E Tests

**Location**: `__tests__/e2e/`

**Guidelines**:
- Test complete user journeys
- Test critical business flows
- Verify Tamil text rendering
- Check responsive design
- Test accessibility

## 🎨 Testing Tamil Content

### Tamil Text Testing Tips

1. **Use actual Tamil text in tests**:
   ```typescript
   expect(screen.getByText('பூ வாசம்')).toBeInTheDocument();
   ```

2. **Test Tamil font rendering**:
   ```typescript
   const fontFamily = await element.evaluate((el) =>
     window.getComputedStyle(el).fontFamily
   );
   expect(fontFamily).toContain('Noto Sans Tamil');
   ```

3. **Test Tamil input handling**:
   ```typescript
   await user.type(input, 'தமிழ் உரை');
   expect(input).toHaveValue('தமிழ் உரை');
   ```

## 📊 Coverage Requirements

- **Minimum Coverage**: 70%
- **Target Coverage**: 85%

**Coverage Thresholds** (configured in `jest.config.ts`):
- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%

## 🔍 Test Patterns

### Domain Entity Testing (DDD)

```typescript
describe('Content Entity', () => {
  it('should create a valid content entity', () => {
    const content = Content.create({
      title: 'பாடல்',
      body: 'உள்ளடக்கம்',
      type: ContentType.SONG,
    });

    expect(content.isValid()).toBe(true);
  });

  it('should validate required fields', () => {
    expect(() => {
      Content.create({ title: '' });
    }).toThrow('Title is required');
  });
});
```

### Repository Testing

```typescript
describe('ContentRepository', () => {
  let repository: ContentRepository;

  beforeEach(() => {
    repository = new ContentRepository(mockDynamoDBClient);
  });

  it('should save content to database', async () => {
    const content = createTestContent();
    await repository.save(content);

    expect(mockDynamoDBClient.put).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.any(Object),
      })
    );
  });
});
```

### Component Testing

```typescript
describe('ContentCard Component', () => {
  it('should display Tamil content correctly', () => {
    const content = {
      title: 'பூ வாசம்',
      description: 'விளக்கம்',
    };

    render(<ContentCard content={content} />);

    expect(screen.getByText('பூ வாசம்')).toBeInTheDocument();
    expect(screen.getByText('விளக்கம்')).toBeInTheDocument();
  });
});
```

## 🚀 Best Practices

1. **Test Behavior, Not Implementation**: Focus on what the code does, not how it does it
2. **Keep Tests Simple**: Each test should verify one thing
3. **Use Descriptive Names**: Test names should describe what they're testing
4. **Arrange-Act-Assert**: Structure tests clearly
5. **Avoid Test Interdependence**: Tests should run independently
6. **Mock External Dependencies**: Don't test third-party code
7. **Test Edge Cases**: Include boundary conditions and error cases
8. **Maintain Tests**: Update tests when requirements change

## 📚 Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

## 🐛 Debugging Tests

### Debug Jest Tests

```bash
# Debug in VS Code
# Add breakpoint and run "Jest: Debug" from command palette

# Debug with Node
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Debug Playwright Tests

```bash
# Run with Playwright Inspector
npx playwright test --debug

# Run with headed browser
npx playwright test --headed

# Generate trace
npx playwright test --trace on
```

---

**Remember**: Write tests first, then implement! 🎯
