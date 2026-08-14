"use client";

import Link from "next/link";
import { ReactNode, useState, useEffect } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { useRouter, usePathname } from "next/navigation";
import "@/lib/amplify-config";
import { clearCognitoCookies } from "@/lib/client-auth";
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
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Kanban,
  Sparkles,
  BarChart3,
  MessageSquare,
  BellRing,
  Library,
  Users,
  BookOpen,
  FlaskConical,
  PenLine,
  SearchCheck,
  ScrollText,
  MessageSquareHeart,
  SlidersHorizontal, Captions} from "lucide-react";
import { FEATURES } from "@/config/features";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "@/components/admin/ThemeProvider";
import { ThemeToggle } from "@/components/admin/ThemeToggle";

interface AdminLayoutClientProps {
  children: ReactNode;
  /**
   * Collapse preference read from the `admin_sidebar_collapsed` cookie on the
   * server, so the first paint already has the right sidebar width — no
   * expand→collapse flash on reload for admins who prefer it collapsed.
   * Defaults to expanded when the server component doesn't supply it.
   */
  initialCollapsed?: boolean;
}

// Persisted in a cookie (not localStorage) so the server layout can read the
// preference and hydrate the sidebar at the correct width. Keep in sync with
// the read in ./layout.tsx.
export const SIDEBAR_COLLAPSE_COOKIE = "admin_sidebar_collapsed";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/admin": {
    title: "Dashboard",
    subtitle: "Overview of your Tamil content platform",
  },
  "/admin/content": {
    title: "Content",
    subtitle: "Manage your Tamil content library",
  },
  "/admin/content/new": {
    title: "New Content",
    subtitle: "Add new Tamil content to your platform",
  },
  "/admin/categories": {
    title: "Categories",
    subtitle: "Organize content into categories",
  },
  "/admin/tags": { title: "Tags", subtitle: "Manage content tags" },
  "/admin/messages": {
    title: "Messages",
    subtitle: "Contact-form submissions",
  },
  "/admin/subscribers": {
    title: "Subscribers",
    subtitle:
      "Email newsletter list — filter by date range, process unsubscribes",
  },
  "/admin/stories": {
    title: "Shared Stories",
    subtitle:
      "Fan memories from the Share page — review, feature, or archive; a songwriting well",
  },
  "/admin/docs": { title: "Docs", subtitle: "In-portal guides and how-tos" },
  "/admin/songs": {
    title: "Songs",
    subtitle: "Audio library — themes, durations, play counts",
  },
  "/admin/lyrics": {
    title: "Lyrics",
    subtitle:
      "பாடல் வரிகள் / Lyrics — publish a song's words behind the email gate; edit the lyrics",
  },
  "/admin/captions": {
    title: "Captions",
    subtitle:
      "Time stored lyrics against a video's own auto-caption track — preview before publishing",
  },
  "/admin/comments": {
    title: "Comments",
    subtitle: "Moderate viewer comments on your content",
  },
  "/admin/notify": {
    title: "Notify",
    subtitle: "Send web-push notifications to subscribers",
  },
  "/admin/compose": {
    title: "Music Director",
    subtitle:
      "Tamil lyrics → full production brief; save briefs as the durable source of truth",
  },
  "/admin/compose/lyrics": {
    title: "Lyricist",
    subtitle:
      "Brief → original Tamil lyrics; review then send to the Music Director",
  },
  "/admin/compose/critique": {
    title: "Lyric Critic",
    subtitle:
      "Your own draft → honest feedback; coaches your craft, never rewrites",
  },
  "/admin/lexicon": {
    title: "Lexicon",
    subtitle:
      "Lyric word-family dictionary — register × usage, to diversify song vocabulary",
  },
  "/admin/music-lab": {
    title: "Music Lab",
    subtitle:
      "Log & evaluate every generation against its brief — turn failed attempts into a research dataset",
  },
  "/admin/mastering": {
    title: "Sound Engineering",
    subtitle:
      "Master a SUNO WAV to a streaming target, then hand it to Adobe — loudness only, never tone",
  },
  "/admin/workflow": {
    title: "Workflow",
    subtitle: "Production pipeline — draft → published",
  },
  "/admin/youtube": {
    title: "YouTube",
    subtitle: "Channel stats and publishing gaps",
  },
  "/admin/analytics": {
    title: "Analytics",
    subtitle: "Website traffic & user activity",
  },
  "/admin/media": {
    title: "Media Library",
    subtitle: "Manage uploaded media files",
  },
  "/admin/settings": {
    title: "Settings",
    subtitle: "Configure your platform settings",
  },
};

export default function AdminLayoutClient({
  children,
  initialCollapsed = false,
}: AdminLayoutClientProps) {
  const { user, signOut } = useAuthenticator((context) => [context.user]);
  const router = useRouter();
  const pathname = usePathname();

  // In this Cognito pool the username is a sub UUID, so prefer the email
  // (from user attributes, else the ID-token claims) for the sidebar identity.
  const u = user as unknown as {
    username?: string;
    attributes?: { email?: string };
    signInUserSession?: { idToken?: { payload?: { email?: string } } };
  };
  const userLabel =
    u?.attributes?.email ||
    u?.signInUserSession?.idToken?.payload?.email ||
    user?.username ||
    "Admin";

  // Mobile drawer state (md-: visible-on-open, md+: irrelevant).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop collapse state (md+ only). Seeded from the server-read cookie so the
  // first paint matches the admin's saved preference (no hydration flash).
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // Close mobile drawer on route change.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        // 1-year cookie; the server layout reads it on the next full load.
        document.cookie = `${SIDEBAR_COLLAPSE_COOKIE}=${
          next ? "1" : "0"
        };path=/;max-age=31536000;samesite=lax`;
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const isEditPage = pathname.includes("/edit");
  const pageInfo = isEditPage
    ? { title: "Edit Content", subtitle: "Update existing content" }
    : PAGE_TITLES[pathname] || {
        title: "Admin",
        subtitle: "Manage your platform",
      };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      // signOut can't purge an already-expired session — force-clear the stale
      // Cognito cookies so logout always works and we don't get wedged in a
      // looks-logged-in-but-401 state.
      clearCognitoCookies();
      router.push("/login");
    }
  };

  // Sidebar widths — kept symmetric with the main-content margin classes
  // below so the layout reflows instead of overlapping on collapse.
  const sidebarWidth = collapsed ? "w-16" : "w-64";
  const mainMargin = collapsed ? "md:ml-16" : "md:ml-64";

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
          className={`fixed left-0 top-0 z-50 flex h-full flex-col overflow-hidden ${sidebarWidth} transform bg-gradient-to-b from-purple-700 to-purple-900 text-white shadow-xl transition-all duration-300 md:translate-x-0 dark:from-purple-900 dark:to-gray-950 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className={collapsed ? "p-4 text-center" : "p-6"}>
            {!collapsed ? (
              <>
                <h1 className="mb-1 font-kavivanar text-2xl font-bold">
                  தமிழகவல்
                </h1>
                <p className="text-xs text-purple-200">Admin Dashboard</p>
              </>
            ) : (
              <h1
                className="font-kavivanar text-xl font-bold"
                title="தமிழகவல் · Admin"
              >
                த
              </h1>
            )}
          </div>

          <nav
            className="mt-2 flex-1 overflow-y-auto pb-4"
            aria-label="Admin navigation"
          >
            <NavLink
              href="/admin"
              icon={LayoutDashboard}
              collapsed={collapsed}
              active={pathname === "/admin"}
            >
              Dashboard
            </NavLink>

            <NavSection label="Content" collapsed={collapsed}>
              <NavLink
                href="/admin/content"
                icon={FileText}
                collapsed={collapsed}
                active={pathname.startsWith("/admin/content")}
              >
                Content
              </NavLink>
              <NavLink
                href="/admin/categories"
                icon={Folder}
                collapsed={collapsed}
                active={pathname === "/admin/categories"}
              >
                Categories
              </NavLink>
              <NavLink
                href="/admin/tags"
                icon={Tag}
                collapsed={collapsed}
                active={pathname === "/admin/tags"}
              >
                Tags
              </NavLink>
              <NavLink
                href="/admin/songs"
                icon={Music}
                collapsed={collapsed}
                active={pathname.startsWith("/admin/songs")}
              >
                Songs
              </NavLink>
              <NavLink
                href="/admin/lyrics"
                icon={ScrollText}
                collapsed={collapsed}
                active={pathname.startsWith("/admin/lyrics")}
              >
                Lyrics
              </NavLink>
              <NavLink
                href="/admin/captions"
                icon={Captions}
                collapsed={collapsed}
                active={pathname.startsWith("/admin/captions")}
              >
                Captions
              </NavLink>
              <NavLink
                href="/admin/workflow"
                icon={Kanban}
                collapsed={collapsed}
                active={pathname === "/admin/workflow"}
              >
                Workflow
              </NavLink>
              {FEATURES.ADMIN.MEDIA_LIBRARY && (
                <NavLink
                  href="/admin/media"
                  icon={Image}
                  collapsed={collapsed}
                  active={pathname === "/admin/media"}
                >
                  Media Library
                </NavLink>
              )}
            </NavSection>

            <NavSection label="Studio" collapsed={collapsed}>
              <NavLink
                href="/admin/compose"
                icon={Sparkles}
                collapsed={collapsed}
                active={pathname === "/admin/compose"}
              >
                Music Director
              </NavLink>
              <NavLink
                href="/admin/compose/lyrics"
                icon={PenLine}
                collapsed={collapsed}
                active={pathname === "/admin/compose/lyrics"}
              >
                Lyricist
              </NavLink>
              <NavLink
                href="/admin/compose/critique"
                icon={SearchCheck}
                collapsed={collapsed}
                active={pathname === "/admin/compose/critique"}
              >
                Lyric Critic
              </NavLink>
              <NavLink
                href="/admin/music-lab"
                icon={FlaskConical}
                collapsed={collapsed}
                active={pathname === "/admin/music-lab"}
              >
                Music Lab
              </NavLink>
              <NavLink
                href="/admin/music-lab/theory"
                icon={Music}
                collapsed={collapsed}
                active={pathname.startsWith("/admin/music-lab/theory")}
              >
                Composition & Theory
              </NavLink>
              <NavLink
                href="/admin/mastering"
                icon={SlidersHorizontal}
                collapsed={collapsed}
                active={pathname === "/admin/mastering"}
              >
                Sound Engineering
              </NavLink>
              <NavLink
                href="/admin/lexicon"
                icon={Library}
                collapsed={collapsed}
                active={pathname === "/admin/lexicon"}
              >
                Lexicon
              </NavLink>
            </NavSection>

            <NavSection label="Audience" collapsed={collapsed}>
              <NavLink
                href="/admin/messages"
                icon={Mail}
                collapsed={collapsed}
                active={pathname === "/admin/messages"}
              >
                Messages
              </NavLink>
              <NavLink
                href="/admin/subscribers"
                icon={Users}
                collapsed={collapsed}
                active={pathname === "/admin/subscribers"}
              >
                Subscribers
              </NavLink>
              <NavLink
                href="/admin/stories"
                icon={MessageSquareHeart}
                collapsed={collapsed}
                active={pathname === "/admin/stories"}
              >
                Shared Stories
              </NavLink>
              <NavLink
                href="/admin/comments"
                icon={MessageSquare}
                collapsed={collapsed}
                active={pathname === "/admin/comments"}
              >
                Comments
              </NavLink>
              <NavLink
                href="/admin/notify"
                icon={BellRing}
                collapsed={collapsed}
                active={pathname === "/admin/notify"}
              >
                Notify
              </NavLink>
            </NavSection>

            <NavSection label="Insights" collapsed={collapsed}>
              <NavLink
                href="/admin/youtube"
                icon={PlaySquare}
                collapsed={collapsed}
                active={pathname === "/admin/youtube"}
              >
                YouTube
              </NavLink>
              <NavLink
                href="/admin/analytics"
                icon={BarChart3}
                collapsed={collapsed}
                active={pathname === "/admin/analytics"}
              >
                Analytics
              </NavLink>
            </NavSection>

            <NavSection label="System" collapsed={collapsed}>
              <NavLink
                href="/admin/docs"
                icon={BookOpen}
                collapsed={collapsed}
                active={pathname === "/admin/docs"}
              >
                Docs
              </NavLink>
              <NavLink
                href="/"
                icon={Globe}
                collapsed={collapsed}
                active={false}
              >
                View Site
              </NavLink>
              {FEATURES.ADMIN.SETTINGS_PAGE && (
                <NavLink
                  href="/admin/settings"
                  icon={Settings}
                  collapsed={collapsed}
                  active={pathname === "/admin/settings"}
                >
                  Settings
                </NavLink>
              )}
            </NavSection>
          </nav>

          <div
            className={`flex-shrink-0 border-t border-purple-600/60 ${collapsed ? "p-2" : "p-4"}`}
          >
            {!collapsed ? (
              <div className="text-sm text-purple-200">
                <p className="truncate font-semibold" title={userLabel}>
                  {userLabel}
                </p>
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
                title={`Logout (${userLabel})`}
                className="flex h-10 w-full items-center justify-center rounded-md text-purple-200 transition-colors hover:bg-purple-700/50 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </aside>

        {/* Main content area — margin flexes with sidebar width */}
        <main
          id="main"
          className={`min-h-screen ml-0 ${mainMargin} transition-[margin] duration-300`}
        >
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
                {/* Desktop sidebar collapse toggle — lives in the header so it
                    never overlaps the sidebar content or the body. */}
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  className="-ml-2 hidden flex-shrink-0 rounded-md p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:flex dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {collapsed ? (
                    <PanelLeftOpen className="h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="h-5 w-5" />
                  )}
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

interface NavSectionProps {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}

// A labelled group of nav links. When the sidebar is collapsed the text label
// would be meaningless, so it degrades to a thin divider between groups.
function NavSection({ label, collapsed, children }: NavSectionProps) {
  return (
    <div className="mt-4">
      {collapsed ? (
        <div
          className="mx-3 mb-2 border-t border-purple-600/40"
          aria-hidden="true"
        />
      ) : (
        <p className="px-6 pb-1 text-[11px] font-semibold uppercase tracking-wider text-purple-300/80">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
  collapsed: boolean;
  active: boolean;
}

function NavLink({
  href,
  icon: Icon,
  children,
  collapsed,
  active,
}: NavLinkProps) {
  const label = typeof children === "string" ? children : undefined;
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`flex items-center transition-colors ${
        collapsed ? "justify-center px-2 py-3" : "gap-3 px-6 py-3"
      } ${
        active
          ? "bg-purple-600/70 text-white"
          : "text-white/90 hover:bg-purple-600/60 hover:text-white"
      }`}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {!collapsed && <span className="font-medium">{children}</span>}
    </Link>
  );
}
