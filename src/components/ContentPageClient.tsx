/**
 * Client-side wrapper for content page
 *
 * Handles client-side features like sidebar
 */

'use client';

import { ContentSidebar } from '@/components/ContentSidebar';

interface ContentPageClientProps {
  contentId: string;
  contentType: string;
  contentTitle: string;
  children: React.ReactNode;
}

export function ContentPageClient({
  contentId,
  contentType,
  contentTitle,
  children
}: ContentPageClientProps) {
  return (
    <>
      {/* Sidebar Component */}
      <ContentSidebar
        currentId={contentId}
        currentType={contentType}
        currentTitle={contentTitle}
      />

      {/* Main Content */}
      {children}
    </>
  );
}