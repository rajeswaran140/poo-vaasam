'use client';

/**
 * Admin Layout
 *
 * Main layout for admin dashboard with sidebar navigation and authentication
 */

import Link from 'next/link';
import { ReactNode } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';
import '@/lib/amplify-config';
import { LucideIcon, LayoutDashboard, FileText, Folder, Tag, Image, Globe, Settings, LogOut, Plus } from 'lucide-react';
import { FEATURES } from '@/config/features';
import { Toaster } from 'react-hot-toast';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const router = useRouter();

  // Note: Middleware already protects admin routes, but we keep this
  // check for user info and signOut functionality

  const handleLogout = async () => {
    try {
      await signOut();
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-gradient-to-b from-purple-700 to-purple-900 text-white shadow-xl z-50">
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-2 font-kavivanar">தமிழகவல்</h1>
          <p className="text-purple-200 text-sm">Admin Dashboard</p>
        </div>

        <nav className="mt-6">
          <NavLink href="/admin" icon={LayoutDashboard}>
            Dashboard
          </NavLink>
          <NavLink href="/admin/content" icon={FileText}>
            Content
          </NavLink>
          <NavLink href="/admin/categories" icon={Folder}>
            Categories
          </NavLink>
          <NavLink href="/admin/tags" icon={Tag}>
            Tags
          </NavLink>

          {/* Media Library - Only shown if feature is enabled */}
          {FEATURES.ADMIN.MEDIA_LIBRARY && (
            <NavLink href="/admin/media" icon={Image}>
              Media Library
            </NavLink>
          )}

          <div className="border-t border-purple-600 my-4 mx-4"></div>

          <NavLink href="/" icon={Globe}>
            View Site
          </NavLink>

          {/* Settings - Only shown if feature is enabled */}
          {FEATURES.ADMIN.SETTINGS_PAGE && (
            <NavLink href="/admin/settings" icon={Settings}>
              Settings
            </NavLink>
          )}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-purple-600">
          <div className="text-sm text-purple-200">
            <p className="font-semibold truncate" title={user?.username || 'Admin'}>
              {user?.username || 'Admin'}
            </p>
            <button
              onClick={handleLogout}
              className="text-xs text-purple-300 hover:text-white mt-1 transition-colors flex items-center gap-1"
            >
              <LogOut className="w-3 h-3" /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 min-h-screen">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
          <div className="px-8 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-gray-800">
                Content Management
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Manage your Tamil content
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/admin/content/new"
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium flex items-center gap-2"
              >
                <Plus className="w-5 h-5" /> New Content
              </Link>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-8">
          {children}
        </div>
      </main>

      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
}

function NavLink({ href, icon: Icon, children }: NavLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-6 py-3 text-white hover:bg-purple-600 transition-colors"
    >
      <Icon className="w-5 h-5" />
      <span className="font-medium">{children}</span>
    </Link>
  );
}

// Note: Toaster component added to admin layout in the return statement above
