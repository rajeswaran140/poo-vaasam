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
      {/* Main Content first so the page <h1> precedes the (fixed, off-canvas)
          sidebar in the DOM/heading order. The sidebar is position:fixed, so
          rendering it after has no visual effect. */}
      {children}

      {/* Off-canvas related-content sidebar */}
      <ContentSidebar
        currentId={contentId}
        currentType={contentType}
        currentTitle={contentTitle}
      />
    </>
  );
}