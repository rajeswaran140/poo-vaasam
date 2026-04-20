/**
 * Admin Layout
 *
 * Main layout for admin dashboard with sidebar navigation
 */

import Link from 'next/link';
import { ReactNode } from 'react';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-gradient-to-b from-purple-700 to-purple-900 text-white shadow-xl z-50">
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-2">பூ வாசம்</h1>
          <p className="text-purple-200 text-sm">Admin Dashboard</p>
        </div>

        <nav className="mt-6">
          <NavLink href="/admin" icon="📊">
            Dashboard
          </NavLink>
          <NavLink href="/admin/content" icon="📝">
            Content
          </NavLink>
          <NavLink href="/admin/categories" icon="📚">
            Categories
          </NavLink>
          <NavLink href="/admin/tags" icon="🏷️">
            Tags
          </NavLink>
          <NavLink href="/admin/media" icon="🖼️">
            Media Library
          </NavLink>

          <div className="border-t border-purple-600 my-4 mx-4"></div>

          <NavLink href="/" icon="🌐">
            View Site
          </NavLink>
          <NavLink href="/admin/settings" icon="⚙️">
            Settings
          </NavLink>
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-purple-600">
          <div className="text-sm text-purple-200">
            <p className="font-semibold">Admin User</p>
            <button className="text-xs text-purple-300 hover:text-white mt-1">
              Logout
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
              <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium">
                + New Content
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

interface NavLinkProps {
  href: string;
  icon: string;
  children: ReactNode;
}

function NavLink({ href, icon, children }: NavLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-6 py-3 text-white hover:bg-purple-600 transition-colors"
    >
      <span className="text-xl">{icon}</span>
      <span className="font-medium">{children}</span>
    </Link>
  );
}
