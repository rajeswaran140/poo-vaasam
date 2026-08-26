/**
 * Canonical admin-nav registry — one entry per admin page.
 *
 * Used by the ⌘K command palette (CommandPalette.tsx) as the source of truth
 * for what pages exist. The sidebar in AdminLayoutClient.tsx currently
 * hardcodes its links — a follow-up PR can render the sidebar from this same
 * config so nav lives in one place.
 *
 * Adding a new admin page? Add its entry here so it shows up in the palette.
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
  MessageSquareHeart,
  BellRing,
  PlaySquare,
  BarChart3,
  Settings,
} from 'lucide-react';

export type AdminNavSection =
  | 'Overview'
  | 'Content'
  | 'Studio'
  | 'Audience'
  | 'Insights'
  | 'System';

export interface AdminNavItem {
  /** Route this entry navigates to. */
  href: string;
  /** Label shown in the palette (and sidebar, once wired). */
  title: string;
  /** Short one-liner — helps disambiguate similarly-named pages. */
  subtitle: string;
  /** Which sidebar section this page belongs to. */
  section: AdminNavSection;
  /** Icon shown in the palette row. */
  icon: LucideIcon;
  /** Extra search terms — aliases + abbreviations the user might type. */
  keywords?: string[];
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  'Overview',
  'Content',
  'Studio',
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

  // Content
  {
    href: '/admin/content',
    title: 'Content',
    subtitle: 'Manage your Tamil content library',
    section: 'Content',
    icon: FileText,
  },
  {
    href: '/admin/categories',
    title: 'Categories',
    subtitle: 'Organize content into categories',
    section: 'Content',
    icon: Folder,
  },
  {
    href: '/admin/tags',
    title: 'Tags',
    subtitle: 'Manage content tags',
    section: 'Content',
    icon: Tag,
  },
  {
    href: '/admin/songs',
    title: 'Songs',
    subtitle: 'Audio library — themes, durations, play counts',
    section: 'Content',
    icon: Music,
  },
  {
    href: '/admin/songs/publish',
    title: 'Publish Song',
    subtitle: 'One-call publish — upload → autolink YouTube → generate cover',
    section: 'Content',
    icon: Rocket,
    keywords: ['upload', 'new song', 'go live'],
  },
  {
    href: '/admin/lyrics',
    title: 'Lyrics',
    subtitle: "பாடல் வரிகள் — publish a song's words behind the email gate",
    section: 'Content',
    icon: PenLine,
  },
  {
    href: '/admin/captions',
    title: 'Captions',
    subtitle: "Time stored lyrics against a video's auto-caption track",
    section: 'Content',
    icon: Captions,
  },
  {
    href: '/admin/workflow',
    title: 'Workflow',
    subtitle: 'Production pipeline — draft → published',
    section: 'Content',
    icon: Kanban,
  },
  {
    href: '/admin/media',
    title: 'Media Library',
    subtitle: 'Manage uploaded media files',
    section: 'Content',
    icon: ImageIcon,
  },
  {
    href: '/admin/release',
    title: 'Release',
    subtitle: 'Release checklist + deploy control',
    section: 'Content',
    icon: Sparkles,
    keywords: ['deploy', 'ship', 'publish', 'go live'],
  },

  // Studio
  {
    href: '/admin/compose',
    title: 'Music Director',
    subtitle: 'Tamil lyrics → full production brief',
    section: 'Studio',
    icon: Sparkles,
    keywords: ['compose', 'brief'],
  },
  {
    href: '/admin/compose/lyrics',
    title: 'Lyricist',
    subtitle: 'Brief → original Tamil lyrics',
    section: 'Studio',
    icon: PenLine,
    keywords: ['compose', 'write'],
  },
  {
    href: '/admin/compose/critique',
    title: 'Lyric Critic',
    subtitle: 'Your own draft → honest feedback',
    section: 'Studio',
    icon: SearchCheck,
    keywords: ['compose', 'review'],
  },
  {
    href: '/admin/music-lab',
    title: 'Music Lab',
    subtitle: 'Log and evaluate every generation against its brief',
    section: 'Studio',
    icon: FlaskConical,
    keywords: ['ml', 'generations'],
  },
  {
    href: '/admin/music-lab/theory',
    title: 'Music Lab · Theory',
    subtitle: 'Music-theory reference for the composer',
    section: 'Studio',
    icon: BookOpen,
    keywords: ['ml', 'theory'],
  },
  {
    href: '/admin/music-lab/meter-lab',
    title: 'Music Lab · Meter Lab',
    subtitle: 'Meter and prosody workbench',
    section: 'Studio',
    icon: Ruler,
    keywords: ['ml', 'prosody', 'meter'],
  },
  {
    href: '/admin/music-lab/notebook',
    title: 'Music Lab · Notebook',
    subtitle: 'Scratchpad for composition experiments',
    section: 'Studio',
    icon: NotebookPen,
    keywords: ['ml', 'scratch'],
  },
  {
    href: '/admin/mastering',
    title: 'Sound Engineering',
    subtitle: 'Master a SUNO WAV to a streaming target',
    section: 'Studio',
    icon: SlidersHorizontal,
    keywords: ['mastering', 'loudness', 'lufs'],
  },
  {
    href: '/admin/lexicon',
    title: 'Lexicon',
    subtitle: 'Lyric word-family dictionary — register × usage',
    section: 'Studio',
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
    icon: ScrollText,
    keywords: ['fan', 'stories'],
  },
  {
    href: '/admin/comments',
    title: 'Comments',
    subtitle: 'Moderate viewer comments on your content',
    section: 'Audience',
    icon: MessageSquareHeart,
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
    href: '/admin/settings',
    title: 'Settings',
    subtitle: 'Configure your platform settings',
    section: 'System',
    icon: Settings,
  },
];
