/**
 * Admin Error Boundary Tests
 *
 * Component tests for admin error boundary
 */

import { render, screen, fireEvent } from '@testing-library/react';
import AdminError from '@/app/(admin)/error';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  AlertTriangle: () => <div data-testid="alert-triangle-icon">AlertTriangle</div>,
  RefreshCw: () => <div data-testid="refresh-icon">RefreshCw</div>,
  Home: () => <div data-testid="home-icon">Home</div>,
}));

describe('Admin Error Boundary', () => {
  const mockReset = jest.fn();
  const mockError = new Error('Test error message');

  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.error for tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it('should render error boundary with error message', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('We encountered an error in the admin panel')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('should display error details section', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.getByText('Error Details:')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('should render Try Again button', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    expect(tryAgainButton).toBeInTheDocument();
  });

  it('should call reset function when Try Again is clicked', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    const tryAgainButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(tryAgainButton);

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('should render Go to Dashboard link', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    const dashboardLink = screen.getByRole('link', { name: /go to dashboard/i });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('href', '/admin');
  });

  it('should display error digest if provided', () => {
    const errorWithDigest = Object.assign(new Error('Test error'), {
      digest: 'abc123xyz',
    });

    render(<AdminError error={errorWithDigest} reset={mockReset} />);

    expect(screen.getByText(/Error ID: abc123xyz/i)).toBeInTheDocument();
  });

  it('should not display error digest if not provided', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.queryByText(/Error ID:/i)).not.toBeInTheDocument();
  });

  it('should display help section with recovery options', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.getByText('What can you do?')).toBeInTheDocument();
    expect(screen.getByText(/Try Again/)).toBeInTheDocument();
    expect(screen.getByText(/Dashboard/)).toBeInTheDocument();
    expect(screen.getByText(/refresh the page/i)).toBeInTheDocument();
    expect(screen.getByText(/internet connection/i)).toBeInTheDocument();
  });

  it('should show stack trace in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const errorWithStack = new Error('Test error');
    errorWithStack.stack = 'Error: Test error\n  at function1\n  at function2';

    render(<AdminError error={errorWithStack} reset={mockReset} />);

    expect(screen.getByText(/Show Stack Trace/i)).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('should hide stack trace in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.queryByText(/Show Stack Trace/i)).not.toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('should log error to console on mount', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(console.error).toHaveBeenCalledWith('Admin Error:', mockError);
  });

  it('should display Tamil branding in footer', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.getByText(/தமிழகவல்/)).toBeInTheDocument();
    expect(screen.getByText(/Admin Dashboard/)).toBeInTheDocument();
  });

  it('should render all required icons', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(screen.getByTestId('alert-triangle-icon')).toBeInTheDocument();
    expect(screen.getByTestId('refresh-icon')).toBeInTheDocument();
    expect(screen.getByTestId('home-icon')).toBeInTheDocument();
  });

  it('should display logged error message in footer', () => {
    render(<AdminError error={mockError} reset={mockReset} />);

    expect(
      screen.getByText(/This error has been logged/i)
    ).toBeInTheDocument();
  });

  it('should handle errors with no message', () => {
    const errorNoMessage = new Error();
    errorNoMessage.message = '';

    render(<AdminError error={errorNoMessage} reset={mockReset} />);

    expect(screen.getByText('Unknown error occurred')).toBeInTheDocument();
  });

  it('should have proper styling classes for error state', () => {
    const { container } = render(<AdminError error={mockError} reset={mockReset} />);

    // Check for error-specific styling
    expect(container.querySelector('.bg-red-500')).toBeInTheDocument();
    expect(container.querySelector('.bg-red-50')).toBeInTheDocument();
    expect(container.querySelector('.border-red-400')).toBeInTheDocument();
  });
});
