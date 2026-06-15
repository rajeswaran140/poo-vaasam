'use client';

import Link from 'next/link';
import { ReactNode, useState, useEffect } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter, usePathname } from 'next/navigation';
import '@/lib/amplify-config';
import { clearCognitoCookies } from '@/lib/client-auth';
import {
  LucideIcon,
  LayoutDashboard,
  FileText,
  Folder,
  Tag,
  Image,
  Globe,
  Settings,
  LogOut,
  Plus,
  Mail,
  PlaySquare,
  Music,
  ChevronLeft,
  ChevronRight,
  Menu,
  Kanban,
  Sparkles,
  BarChart3,
  MessageSquare,
  BellRing,
} from 'lucide-react';
import { FEATURES } from '@/config/features';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from '@/components/admin/ThemeProvider';
import { ThemeToggle } from '@/components/admin/ThemeToggle';

interface AdminLayoutProps {
  children: ReactNode;
}

const SIDEBAR_COLLAPSE_KEY = 'tamilagaval:admin-sidebar-collapsed';

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/admin': { title: 'Dashboard', subtitle: 'Overview of your Tamil content platform' },
  '/admin/content': { title: 'Content', subtitle: 'Manage your Tamil content library' },
  '/admin/content/new': { title: 'New Content', subtitle: 'Add new Tamil content to your platform' },
  '/admin/categories': { title: 'Categories', subtitle: 'Organize content into categories' },
  '/admin/tags': { title: 'Tags', subtitle: 'Manage content tags' },
  '/admin/messages': { title: 'Messages', subtitle: 'Contact-form submissions' },
  '/admin/songs': { title: 'Songs', subtitle: 'Audio library — themes, durations, play counts' },
  '/admin/compose': { title: 'Music Director', subtitle: 'Tamil lyrics → full production brief; save briefs as the durable source of truth' },
  '/admin/workflow': { title: 'Workflow', subtitle: 'Production pipeline — draft → published' },
  '/admin/youtube': { title: 'YouTube', subtitle: 'Channel stats and publishing gaps' },
  '/admin/analytics': { title: 'Analytics', subtitle: 'Website traffic & user activity' },
  '/admin/media': { title: 'Media Library', subtitle: 'Manage uploaded media files' },
  '/admin/settings': { title: 'Settings', subtitle: 'Configure your platform settings' },
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const router = useRouter();
  const pathname = usePathname();

  // Mobile drawer state (md-: visible-on-open, md+: irrelevant).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop collapse state (md+ only) — persisted to localStorage so the
  // admin's preference sticks across navigations and reloads.
  const [collapsed, setCollapsed] = useState(false);

  // Close mobile drawer on route change.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Hydrate sidebar collapse from storage.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1');
    } catch { /* ignore */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const isEditPage = pathname.includes('/edit');
  const pageInfo = isEditPage
    ? { title: 'Edit Content', subtitle: 'Update existing content' }
    : (PAGE_TITLES[pathname] || { title: 'Admin', subtitle: 'Manage your platform' });

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      // signOut can't purge an already-expired session — force-clear the stale
      // Cognito cookies so logout always works and we don't get wedged in a
      // looks-logged-in-but-401 state.
      clearCognitoCookies();
      router.push('/login');
    }
  };

  // Sidebar widths — kept symmetric with the main-content margin classes
  // below so the layout reflows instead of overlapping on collapse.
  const sidebarWidth = collapsed ? 'w-16' : 'w-64';
  const mainMargin = collapsed ? 'md:ml-16' : 'md:ml-64';

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-gray-50 text-gray-900 transition-colors dark:bg-gray-950 dark:text-gray-100">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed left-0 top-0 z-50 h-full ${sidebarWidth} transform bg-gradient-to-b from-purple-700 to-purple-900 text-white shadow-xl transition-all duration-300 md:translate-x-0 dark:from-purple-900 dark:to-gray-950 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className={`${collapsed ? 'p-4 text-center' : 'p-6'} relative`}>
            {!collapsed ? (
              <>
                <h1 className="mb-1 font-kavivanar text-2xl font-bold">தமிழகவல்</h1>
                <p className="text-xs text-purple-200">Admin Dashboard</p>
              </>
            ) : (
              <h1 className="font-kavivanar text-xl font-bold" title="தமிழகவல் · Admin">த</h1>
            )}

            {/* Desktop collapse button — anchored to the sidebar's right edge */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="absolute -right-3 top-6 hidden h-6 w-6 items-center justify-center rounded-full border border-purple-500/60 bg-purple-700 text-white shadow-md transition-colors hover:bg-purple-600 md:flex"
            >
              {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
            </button>
          </div>

          <nav className="mt-2">
            <NavLink href="/admin" icon={LayoutDashboard} collapsed={collapsed} active={pathname === '/admin'}>Dashboard</NavLink>
            <NavLink href="/admin/content" icon={FileText} collapsed={collapsed} active={pathname.startsWith('/admin/content')}>Content</NavLink>
            <NavLink href="/admin/categories" icon={Folder} collapsed={collapsed} active={pathname === '/admin/categories'}>Categories</NavLink>
            <NavLink href="/admin/tags" icon={Tag} collapsed={collapsed} active={pathname === '/admin/tags'}>Tags</NavLink>
            <NavLink href="/admin/messages" icon={Mail} collapsed={collapsed} active={pathname === '/admin/messages'}>Messages</NavLink>
            <NavLink href="/admin/songs" icon={Music} collapsed={collapsed} active={pathname === '/admin/songs'}>Songs</NavLink>
            <NavLink href="/admin/compose" icon={Sparkles} collapsed={collapsed} active={pathname === '/admin/compose'}>Music Director</NavLink>
            <NavLink href="/admin/workflow" icon={Kanban} collapsed={collapsed} active={pathname === '/admin/workflow'}>Workflow</NavLink>
            <NavLink href="/admin/youtube" icon={PlaySquare} collapsed={collapsed} active={pathname === '/admin/youtube'}>YouTube</NavLink>
            <NavLink href="/admin/comments" icon={MessageSquare} collapsed={collapsed} active={pathname === '/admin/comments'}>Comments</NavLink>
            <NavLink href="/admin/notify" icon={BellRing} collapsed={collapsed} active={pathname === '/admin/notify'}>Notify</NavLink>
            <NavLink href="/admin/analytics" icon={BarChart3} collapsed={collapsed} active={pathname === '/admin/analytics'}>Analytics</NavLink>

            {FEATURES.ADMIN.MEDIA_LIBRARY && (
              <NavLink href="/admin/media" icon={Image} collapsed={collapsed} active={pathname === '/admin/media'}>Media Library</NavLink>
            )}

            <div className="my-4 mx-4 border-t border-purple-600/60"></div>

            <NavLink href="/" icon={Globe} collapsed={collapsed} active={false}>View Site</NavLink>

            {FEATURES.ADMIN.SETTINGS_PAGE && (
              <NavLink href="/admin/settings" icon={Settings} collapsed={collapsed} active={pathname === '/admin/settings'}>Settings</NavLink>
            )}
          </nav>

          <div className={`absolute bottom-0 left-0 right-0 border-t border-purple-600/60 ${collapsed ? 'p-2' : 'p-4'}`}>
            {!collapsed ? (
              <div className="text-sm text-purple-200">
                <p className="truncate font-semibold" title={user?.username || 'Admin'}>{user?.username || 'Admin'}</p>
                <button
                  onClick={handleLogout}
                  className="mt-1 flex items-center gap-1 text-xs text-purple-300 transition-colors hover:text-white"
                >
                  <LogOut className="h-3 w-3" /> Logout
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogout}
                aria-label="Logout"
                title={`Logout (${user?.username || 'Admin'})`}
                className="flex h-10 w-full items-center justify-center rounded-md text-purple-200 transition-colors hover:bg-purple-700/50 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </aside>

        {/* Main content area — margin flexes with sidebar width */}
        <main id="main" className={`min-h-screen ml-0 ${mainMargin} transition-[margin] duration-300`}>
          {/* Header */}
          <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur shadow-sm dark:border-gray-800 dark:bg-gray-900/90">
            <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="-ml-2 flex-shrink-0 p-2 text-gray-600 hover:text-gray-900 md:hidden dark:text-gray-400 dark:hover:text-white"
                  aria-label="Open menu"
                >
                  <Menu className="h-6 w-6" />
                </button>
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold text-gray-800 sm:text-2xl dark:text-gray-100">
                    {pageInfo.title}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
                    {pageInfo.subtitle}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
                <ThemeToggle />
                <Link
                  href="/admin/content/new"
                  className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 sm:px-4"
                >
                  <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span className="hidden sm:inline">New Content</span>
                </Link>
              </div>
            </div>
          </header>

          <div className="p-4 sm:p-8">{children}</div>
        </main>

        <Toaster />
      </div>
    </ThemeProvider>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
  collapsed: boolean;
  active: boolean;
}

function NavLink({ href, icon: Icon, children, collapsed, active }: NavLinkProps) {
  const label = typeof children === 'string' ? children : undefined;
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center transition-colors ${
        collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-6 py-3'
      } ${
        active
          ? 'bg-purple-600/70 text-white'
          : 'text-white/90 hover:bg-purple-600/60 hover:text-white'
      }`}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {!collapsed && <span className="font-medium">{children}</span>}
    </Link>
  );
}
