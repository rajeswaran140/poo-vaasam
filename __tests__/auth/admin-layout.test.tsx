/**
 * Admin Layout Authentication Tests
 *
 * Tests client-side authentication protection for admin routes
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
// The default export of (admin)/layout is now a thin async server component
// that only reads the collapse cookie and delegates to AdminLayoutClient.
// These tests exercise the interactive client behaviour, so target it directly.
import AdminLayout from '@/app/(admin)/AdminLayoutClient';

// Mock Next.js router and pathname
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

// Mock Amplify UI React
jest.mock('@aws-amplify/ui-react', () => ({
  useAuthenticator: jest.fn(),
}));

// Mock Amplify config
jest.mock('@/lib/amplify-config', () => ({}));

// Mock Lucide icons
jest.mock('lucide-react', () => ({
  LayoutDashboard: () => <div data-testid="icon-dashboard" />,
  FileText: () => <div data-testid="icon-content" />,
  Folder: () => <div data-testid="icon-categories" />,
  Tag: () => <div data-testid="icon-tags" />,
  Image: () => <div data-testid="icon-media" />,
  Globe: () => <div data-testid="icon-globe" />,
  Settings: () => <div data-testid="icon-settings" />,
  LogOut: () => <div data-testid="icon-logout" />,
  Plus: () => <div data-testid="icon-plus" />,
  Mail: () => <div data-testid="icon-messages" />,
  Users: () => <div data-testid="icon-subscribers" />,
  BookOpen: () => <div data-testid="icon-docs" />,
  PlaySquare: () => <div data-testid="icon-youtube" />,
  Music: () => <div data-testid="icon-songs" />,
  ScrollText: () => <div data-testid="icon-lyrics" />,
  Library: () => <div data-testid="icon-lexicon" />,
  FlaskConical: () => <div data-testid="icon-music-lab" />,
  SlidersHorizontal: () => <div data-testid="icon-mastering" />,
  PanelLeftClose: () => <div data-testid="icon-collapse" />,
  PanelLeftOpen: () => <div data-testid="icon-expand" />,
  Menu: () => <div data-testid="icon-menu" />,
  Sun: () => <div data-testid="icon-sun" />,
  Moon: () => <div data-testid="icon-moon" />,
  Kanban: () => <div data-testid="icon-workflow" />,
  Sparkles: () => <div data-testid="icon-compose" />,
  PenLine: () => <div data-testid="icon-lyricist" />,
  SearchCheck: () => <div data-testid="icon-critic" />,
  BarChart3: () => <div data-testid="icon-analytics" />,
  MessageSquare: () => <div data-testid="icon-comments" />,
  MessageSquareHeart: () => <div data-testid="icon-stories" />,
  BellRing: () => <div data-testid="icon-notify" />,
}));

describe('Admin Layout Authentication', () => {
  const mockPush = jest.fn();
  const mockSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (usePathname as jest.Mock).mockReturnValue('/admin');
  });

  describe('Authenticated User', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: {
            loginId: 'test@example.com',
          },
        },
        signOut: mockSignOut,
      });
    });

    it('should render layout when user is authenticated', () => {
      render(
        <AdminLayout>
          <div>Test Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('தமிழகவல்')).toBeInTheDocument();
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Test Page Body')).toBeInTheDocument();
    });

    it('should display user email in sidebar', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('should render all navigation links', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // Dashboard appears in both sidebar nav and header — use getAllByText
      expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByRole('link', { name: /content/i }).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Categories').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Tags').length).toBeGreaterThanOrEqual(1);
      // Media Library and Settings are feature-flagged; check core links only
      expect(screen.getByText('View Site')).toBeInTheDocument();
    });

    it('should render logout button', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    it('should call signOut and redirect when logout clicked', async () => {
      mockSignOut.mockResolvedValue(undefined);

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const logoutButton = screen.getByText('Logout');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });

    it('should handle logout error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockSignOut.mockRejectedValue(new Error('Logout failed'));

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const logoutButton = screen.getByText('Logout');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith('Error signing out:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    it('should render children content in main area', () => {
      render(
        <AdminLayout>
          <div data-testid="child-content">Dashboard Main Area</div>
        </AdminLayout>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Main Area')).toBeInTheDocument();
    });

    it('should show "New Content" button in header', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('New Content')).toBeInTheDocument();
    });
  });

  describe('Sidebar — page titles & active state (2026-06-26 audit)', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com', signInDetails: { loginId: 'test@example.com' } },
        signOut: mockSignOut,
      });
    });

    it('shows a real header title for /admin/comments (not the generic "Admin" fallback)', () => {
      (usePathname as jest.Mock).mockReturnValue('/admin/comments');
      render(<AdminLayout><div>Body</div></AdminLayout>);
      expect(screen.getByRole('heading', { level: 2, name: 'Comments' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Admin' })).not.toBeInTheDocument();
    });

    it('shows a real header title for /admin/notify', () => {
      (usePathname as jest.Mock).mockReturnValue('/admin/notify');
      render(<AdminLayout><div>Body</div></AdminLayout>);
      expect(screen.getByRole('heading', { level: 2, name: 'Notify' })).toBeInTheDocument();
    });

    it('marks the Songs nav item active on the /admin/songs/publish sub-route', () => {
      (usePathname as jest.Mock).mockReturnValue('/admin/songs/publish');
      render(<AdminLayout><div>Body</div></AdminLayout>);
      expect(screen.getByRole('link', { name: 'Songs' })).toHaveAttribute('aria-current', 'page');
    });

    it('lays the sidebar out as a flex column so the email block never overlaps the nav', () => {
      (usePathname as jest.Mock).mockReturnValue('/admin/docs');
      const { container } = render(<AdminLayout><div>Body</div></AdminLayout>);
      // sidebar is a flex column; the nav scrolls instead of flowing under the footer
      expect(container.querySelector('aside')).toHaveClass('flex', 'flex-col');
      expect(container.querySelector('nav')).toHaveClass('overflow-y-auto');
      // the user/email block is a normal flex child, NOT absolutely positioned
      const emailBlock = screen.getByText('test@example.com').closest('div.border-t');
      expect(emailBlock).not.toHaveClass('absolute');
      expect(emailBlock).toHaveClass('flex-shrink-0');
    });
  });

  describe('Unauthenticated User', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
        signOut: mockSignOut,
      });
    });

    it('should not trigger redirect on render when user is not authenticated', () => {
      // Middleware handles redirect at the edge; layout renders regardless of user state
      render(
        <AdminLayout>
          <div>Protected Page</div>
        </AdminLayout>
      );

      // No automatic redirect from the layout component itself
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should still render the layout structure when user is null', () => {
      const { container } = render(
        <AdminLayout>
          <div>Protected Page</div>
        </AdminLayout>
      );

      // Layout renders (middleware handles auth protection)
      expect(container.firstChild).not.toBeNull();
    });

    it('should render children even when user is null', () => {
      render(
        <AdminLayout>
          <div data-testid="protected">Page Content</div>
        </AdminLayout>
      );

      // Layout renders children (auth is handled by middleware)
      expect(screen.getByTestId('protected')).toBeInTheDocument();
    });
  });

  describe('User State Changes', () => {
    it('should redirect to login when logout button is clicked', async () => {
      mockSignOut.mockResolvedValue(undefined);

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: { loginId: 'test@example.com' },
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const logoutButton = screen.getByText('Logout');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('User Display', () => {
    it('should display username when loginId is not available', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'fallback@example.com',
          signInDetails: null,
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // Layout shows user.username when signInDetails is null
      expect(screen.getByText('fallback@example.com')).toBeInTheDocument();
    });

    it('shows the EMAIL (from attributes), not the Cognito sub-UUID username', () => {
      // Real pool: username is a sub UUID; email lives in attributes.
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: '3ccd3518-d0d1-709b-c087-1258567396dd',
          attributes: { email: 'rajeswaran.pro@gmail.com' },
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('rajeswaran.pro@gmail.com')).toBeInTheDocument();
      expect(screen.queryByText('3ccd3518-d0d1-709b-c087-1258567396dd')).not.toBeInTheDocument();
    });

    it('falls back to the ID-token email claim when attributes are absent', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: '3ccd3518-d0d1-709b-c087-1258567396dd',
          signInUserSession: { idToken: { payload: { email: 'raj@tamilagaval.com' } } },
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('raj@tamilagaval.com')).toBeInTheDocument();
      expect(screen.queryByText(/3ccd3518/)).not.toBeInTheDocument();
    });

    it('should truncate long email addresses', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'verylongemailaddress@example.com',
          signInDetails: {
            loginId: 'verylongemailaddress@example.com',
          },
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const emailElement = screen.getByText('verylongemailaddress@example.com');
      expect(emailElement).toHaveClass('truncate');
    });
  });

  describe('Navigation', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: { loginId: 'test@example.com' },
        },
        signOut: mockSignOut,
      });
    });

    it('should have correct href for dashboard link', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // Dashboard text appears in both sidebar and header; find the nav link specifically
      const allLinks = screen.getAllByRole('link');
      const dashboardLink = allLinks.find(link => link.getAttribute('href') === '/admin');
      expect(dashboardLink).toBeDefined();
      expect(dashboardLink).toHaveAttribute('href', '/admin');
    });

    it('should have correct href for content link', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // Use more specific selector to avoid collision
      const navLinks = screen.getAllByRole('link');
      const contentLink = navLinks.find(link => link.getAttribute('href') === '/admin/content');
      expect(contentLink).toHaveAttribute('href', '/admin/content');
    });

    it('should have correct href for view site link', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const viewSiteLink = screen.getByText('View Site').closest('a');
      expect(viewSiteLink).toHaveAttribute('href', '/');
    });
  });

  describe('Layout Structure', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: { loginId: 'test@example.com' },
        },
        signOut: mockSignOut,
      });
    });

    it('should have fixed sidebar', () => {
      const { container } = render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveClass('fixed');
    });

    it('should have sticky header', () => {
      const { container } = render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const header = container.querySelector('header');
      expect(header).toHaveClass('sticky');
    });
  });
});
