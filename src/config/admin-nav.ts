/**
 * Canonical admin-nav registry — one entry per admin page.
 *
 * Single source of truth for BOTH the sidebar (AdminLayoutClient.tsx) and
 * the ⌘K command palette (CommandPalette.tsx). Add a new admin page here
 * and it appears in both surfaces (unless you opt-out via hiddenInSidebar
 * or hiddenInPalette).
 */

import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  FileText,
  Folder,
  Tag,
  Music,
  PenLine,
  Captions,
  Kanban,
  Image as ImageIcon,
  Rocket,
  Sparkles,
  SearchCheck,
  FlaskConical,
  BookOpen,
  Ruler,
  NotebookPen,
  SlidersHorizontal,
  Library,
  Mail,
  Users,
  ScrollText,
  MessageSquare,
  MessageSquareHeart,
  BellRing,
  PlaySquare,
  BarChart3,
  Settings,
  Globe,
} from 'lucide-react';
import { FEATURES } from '@/config/features';

export type AdminNavSection =
  | 'Overview'
  | 'Library'
  | 'Songs'
  | 'Compose'
  | 'Music Lab'
  | 'Sound'
  | 'Audience'
  | 'Insights'
  | 'System';

/** Which admin feature flag (if any) gates this item's sidebar visibility. */
export type AdminFeatureGate = 'MEDIA_LIBRARY' | 'SETTINGS_PAGE';

export interface AdminNavItem {
  /** Route this entry navigates to. */
  href: string;
  /** Label shown in both sidebar and palette. */
  title: string;
  /** Short one-liner — palette-only (helps disambiguate similar names). */
  subtitle: string;
  /** Which sidebar section this page belongs to. */
  section: AdminNavSection;
  /** Icon shown in both sidebar and palette. */
  icon: LucideIcon;
  /**
   * How to compute the active state for the sidebar highlight:
   *   'exact'  — `pathname === href` (default)
   *   'prefix' — `pathname.startsWith(href)` (for pages with sub-routes)
   */
  matchMode?: 'exact' | 'prefix';
  /** Extra search terms — aliases + abbreviations the user might type. */
  keywords?: string[];
  /** Hide from the sidebar (still shows in palette). */
  hiddenInSidebar?: boolean;
  /** Hide from the palette (still shows in sidebar). */
  hiddenInPalette?: boolean;
  /** Only render when the named FEATURES.ADMIN.* flag is enabled. */
  featureFlag?: AdminFeatureGate;
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  'Overview',
  'Library',
  'Songs',
  'Compose',
  'Music Lab',
  'Sound',
  'Audience',
  'Insights',
  'System',
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  // Overview
  {
    href: '/admin',
    title: 'Dashboard',
    subtitle: 'Overview of your Tamil content platform',
    section: 'Overview',
    icon: LayoutDashboard,
    keywords: ['home', 'kpi'],
  },

  // Library + Songs
  {
    href: '/admin/content',
    title: 'Content',
    subtitle: 'Manage your Tamil content library',
    section: 'Library',
    icon: FileText,
    matchMode: 'prefix',
  },
  {
    href: '/admin/categories',
    title: 'Categories',
    subtitle: 'Organize content into categories',
    section: 'Library',
    icon: Folder,
  },
  {
    href: '/admin/tags',
    title: 'Tags',
    subtitle: 'Manage content tags',
    section: 'Library',
    icon: Tag,
  },
  {
    href: '/admin/songs',
    title: 'Songs',
    subtitle: 'Audio library — themes, durations, play counts',
    section: 'Songs',
    icon: Music,
    matchMode: 'prefix',
  },
  {
    href: '/admin/songs/publish',
    title: 'Publish Song',
    subtitle: 'One-call publish — upload → autolink YouTube → generate cover',
    section: 'Songs',
    icon: Rocket,
    keywords: ['upload', 'new song', 'go live'],
    hiddenInSidebar: true, // reachable from Songs page; palette-only for now
  },
  {
    href: '/admin/lyrics',
    title: 'Lyrics',
    subtitle: "பாடல் வரிகள் — publish a song's words behind the email gate",
    section: 'Songs',
    icon: ScrollText,
    matchMode: 'prefix',
  },
  {
    href: '/admin/captions',
    title: 'Captions',
    subtitle: "Time stored lyrics against a video's auto-caption track",
    section: 'Songs',
    icon: Captions,
    matchMode: 'prefix',
  },
  {
    href: '/admin/workflow',
    title: 'Workflow',
    subtitle: 'Production pipeline — draft → published',
    section: 'Songs',
    icon: Kanban,
  },
  {
    href: '/admin/media',
    title: 'Media Library',
    subtitle: 'Manage uploaded media files',
    section: 'Library',
    icon: ImageIcon,
    featureFlag: 'MEDIA_LIBRARY',
  },
  {
    href: '/admin/release',
    title: 'Release',
    subtitle: 'Release checklist + deploy control',
    section: 'Songs',
    icon: Sparkles,
    keywords: ['deploy', 'ship', 'publish', 'go live'],
    hiddenInSidebar: true, // palette-only for now
  },

  // Compose + Music Lab + Sound
  {
    href: '/admin/compose',
    title: 'Music Director',
    subtitle: 'Tamil lyrics → full production brief',
    section: 'Compose',
    icon: Sparkles,
    keywords: ['compose', 'brief'],
  },
  {
    href: '/admin/compose/lyrics',
    title: 'Lyricist',
    subtitle: 'Brief → original Tamil lyrics',
    section: 'Compose',
    icon: PenLine,
    keywords: ['compose', 'write'],
  },
  {
    href: '/admin/suno-prompts',
    title: 'Suno Prompts',
    subtitle: 'Lyrics → style box, exclude list and sliders, saved for reuse',
    section: 'Compose',
    icon: SlidersHorizontal,
    keywords: ['suno', 'prompt', 'style', 'exclude', 'weirdness'],
  },
  {
    href: '/admin/compose/critique',
    title: 'Lyric Critic',
    subtitle: 'Your own draft → honest feedback',
    section: 'Compose',
    icon: SearchCheck,
    keywords: ['compose', 'review'],
  },
  {
    href: '/admin/music-lab',
    title: 'Music Lab',
    subtitle: 'Log and evaluate every generation against its brief',
    section: 'Music Lab',
    icon: FlaskConical,
    keywords: ['ml', 'generations'],
  },
  {
    href: '/admin/music-lab/theory',
    title: 'Composition & Theory',
    subtitle: 'Music-theory reference for the composer',
    section: 'Music Lab',
    icon: Music,
    matchMode: 'prefix',
    keywords: ['ml', 'theory'],
  },
  {
    href: '/admin/music-lab/meter-lab',
    title: 'Lyric Meter Lab',
    subtitle: 'Meter and prosody workbench',
    section: 'Music Lab',
    icon: Ruler,
    matchMode: 'prefix',
    keywords: ['ml', 'prosody', 'meter'],
  },
  {
    href: '/admin/music-lab/notebook',
    title: 'Composition Notebook',
    subtitle: 'Scratchpad for composition experiments',
    section: 'Music Lab',
    icon: NotebookPen,
    matchMode: 'prefix',
    keywords: ['ml', 'scratch'],
  },
  {
    href: '/admin/mastering',
    title: 'Sound Engineering',
    subtitle: 'Master a SUNO WAV to a streaming target',
    section: 'Sound',
    icon: SlidersHorizontal,
    keywords: ['mastering', 'loudness', 'lufs'],
  },
  {
    href: '/admin/lexicon',
    title: 'Lexicon',
    subtitle: 'Lyric word-family dictionary — register × usage',
    section: 'Sound',
    icon: Library,
  },

  // Audience
  {
    href: '/admin/messages',
    title: 'Messages',
    subtitle: 'Contact-form submissions',
    section: 'Audience',
    icon: Mail,
  },
  {
    href: '/admin/subscribers',
    title: 'Subscribers',
    subtitle: 'Email newsletter list — filter, process unsubscribes',
    section: 'Audience',
    icon: Users,
  },
  {
    href: '/admin/stories',
    title: 'Shared Stories',
    subtitle: 'Fan memories from the Share page',
    section: 'Audience',
    icon: MessageSquareHeart,
    keywords: ['fan', 'stories'],
  },
  {
    href: '/admin/comments',
    title: 'Comments',
    subtitle: 'Moderate viewer comments on your content',
    section: 'Audience',
    icon: MessageSquare,
  },
  {
    href: '/admin/notify',
    title: 'Notify',
    subtitle: 'Send web-push notifications to subscribers',
    section: 'Audience',
    icon: BellRing,
    keywords: ['push', 'broadcast'],
  },

  // Insights
  {
    href: '/admin/youtube',
    title: 'YouTube',
    subtitle: 'Channel stats and publishing gaps',
    section: 'Insights',
    icon: PlaySquare,
    keywords: ['yt', 'video'],
  },
  {
    href: '/admin/analytics',
    title: 'Analytics',
    subtitle: 'Website traffic and user activity',
    section: 'Insights',
    icon: BarChart3,
    keywords: ['ga4', 'traffic'],
  },

  // System
  {
    href: '/admin/docs',
    title: 'Docs',
    subtitle: 'In-portal guides and how-tos',
    section: 'System',
    icon: BookOpen,
    keywords: ['help', 'guide'],
  },
  {
    href: '/',
    title: 'View Site',
    subtitle: 'Open the public site in a new tab',
    section: 'System',
    icon: Globe,
    hiddenInPalette: true, // links out of admin — palette stays admin-only
  },
  {
    href: '/admin/settings',
    title: 'Settings',
    subtitle: 'Configure your platform settings',
    section: 'System',
    icon: Settings,
    featureFlag: 'SETTINGS_PAGE',
  },
];

/** True when this item should render in the sidebar (feature-flag + explicit opt-out). */
export function isSidebarVisible(item: AdminNavItem): boolean {
  if (item.hiddenInSidebar) return false;
  if (item.featureFlag && !FEATURES.ADMIN[item.featureFlag]) return false;
  return true;
}

/** True when this item should appear in the ⌘K palette. */
export function isPaletteVisible(item: AdminNavItem): boolean {
  return !item.hiddenInPalette;
}
