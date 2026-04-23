/**
 * Content List Page (Client Component)
 *
 * Shows all content with edit/delete functionality
 */

'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import showToast from '@/lib/toast';

type FilterType = 'ALL' | 'SONGS' | 'POEMS' | 'LYRICS' | 'STORIES' | 'ESSAYS';
type FilterStatus = 'ALL' | 'PUBLISHED' | 'DRAFT';

export default function ContentListPage() {
  const [content, setContent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<FilterType>('ALL');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');
  const [_lastEvaluatedKey, setLastEvaluatedKey] = useState<Record<string, any> | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string; title: string }>({
    isOpen: false,
    id: '',
    title: '',
  });
  const [deleting, setDeleting] = useState(false);

  const ITEMS_PER_PAGE = 20;

  const loadContent = useCallback(async (reset: boolean = false) => {
    try {
      setLoading(true);

      // Build API URL based on filters
      let url = '/api/admin/content';

      // Apply type filter if not ALL
      if (typeFilter !== 'ALL') {
        url = `/api/admin/content?type=${typeFilter}`;
      }

      // Apply status filter if set
      if (statusFilter !== 'ALL') {
        url += `${url.includes('?') ? '&' : '?'}status=${statusFilter}`;
      }

      const response = await fetch(url, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        const items = data.data.items || [];

        if (reset) {
          setContent(items);
          setCurrentPage(1);
        } else {
          setContent((prev) => [...prev, ...items]);
        }

        setLastEvaluatedKey(data.data.lastEvaluatedKey);
        setHasMore(data.data.hasMore || false);
      }
    } catch (error) {
      console.error('Failed to load content:', error);
      showToast.error('உள்ளடக்கத்தை ஏற்ற முடியவில்லை');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    loadContent(true);
  }, [loadContent]);

  async function handleDeleteContent() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/content?id=${deleteModal.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        showToast.success('உள்ளடக்கம் நீக்கப்பட்டது!');
        setDeleteModal({ isOpen: false, id: '', title: '' });
        loadContent(true); // Reload list from beginning
      } else {
        showToast.error('நீக்க முடியவில்லை: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Delete error:', error);
      showToast.error('உள்ளடக்கத்தை நீக்க முடியவில்லை');
    } finally {
      setDeleting(false);
    }
  }

  function handlePreviousPage() {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  }

  function handleNextPage() {
    if (hasMore || currentPage * ITEMS_PER_PAGE < content.length) {
      setCurrentPage(currentPage + 1);
    }
  }

  // Calculate paginated items for display
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedContent = content.slice(startIndex, endIndex);
  const totalPages = Math.ceil(content.length / ITEMS_PER_PAGE);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-xl text-gray-600">Loading content...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Content</h1>
          <p className="text-gray-500 mt-1">
            Manage your Tamil content library
          </p>
        </div>
        <Link
          href="/admin/content/new"
          className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
        >
          + Create New Content
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap gap-4">
          <FilterButton
            label="All"
            active={typeFilter === 'ALL'}
            onClick={() => setTypeFilter('ALL')}
          />
          <FilterButton
            label="Songs"
            active={typeFilter === 'SONGS'}
            onClick={() => setTypeFilter('SONGS')}
          />
          <FilterButton
            label="Poems"
            active={typeFilter === 'POEMS'}
            onClick={() => setTypeFilter('POEMS')}
          />
          <FilterButton
            label="Lyrics"
            active={typeFilter === 'LYRICS'}
            onClick={() => setTypeFilter('LYRICS')}
          />
          <FilterButton
            label="Stories"
            active={typeFilter === 'STORIES'}
            onClick={() => setTypeFilter('STORIES')}
          />
          <FilterButton
            label="Essays"
            active={typeFilter === 'ESSAYS'}
            onClick={() => setTypeFilter('ESSAYS')}
          />
          <div className="ml-auto">
            <select
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            >
              <option value="ALL">All Status</option>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {content.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-6xl mb-4">📝</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No content yet
            </h3>
            <p className="text-gray-500 mb-6">
              Start building your Tamil content library by creating your first item
            </p>
            <Link
              href="/admin/content/new"
              className="inline-block px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
            >
              Create Your First Content
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Author
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Views
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedContent.map((item: any) => (
                  <tr
                    key={item.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-gray-900 font-tamil text-base">
                          {item._title}
                        </div>
                        {item._description && (
                          <div className="text-sm text-gray-500 font-tamil mt-1 line-clamp-1">
                            {item._description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TypeBadge type={item.type} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-tamil">
                      {item._author}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={item._status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item._viewCount || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(item.createdAt).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/content/${item.id}/edit`}
                          className="px-3 py-1 text-purple-600 hover:bg-purple-50 rounded transition-colors"
                        >
                          Edit
                        </Link>
                        <Link
                          href={`/content/${item.id}`}
                          target="_blank"
                          className="px-3 py-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => setDeleteModal({ isOpen: true, id: item.id, title: item._title })}
                          className="px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {content.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing <span className="font-medium">{startIndex + 1}</span> to{' '}
            <span className="font-medium">{Math.min(endIndex, content.length)}</span> of{' '}
            <span className="font-medium">{content.length}</span> results
          </p>
          <div className="flex gap-2">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            {/* Page numbers */}
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-purple-600 text-white'
                    : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {page}
              </button>
            ))}

            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, id: '', title: '' })}
        onConfirm={handleDeleteContent}
        title="Delete Content?"
        message={`நீங்கள் "${deleteModal.title}" உள்ளடக்கத்தை நிரந்தரமாக நீக்க விரும்புகிறீர்களா? இந்த செயலை மாற்ற முடியாது.`}
        confirmText="Delete Content"
        cancelText="Cancel"
        isDangerous={true}
        isLoading={deleting}
      />
    </div>
  );
}

function FilterButton({ label, active = false, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
        active
          ? 'bg-purple-600 text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    SONGS: 'bg-blue-100 text-blue-800',
    POEMS: 'bg-green-100 text-green-800',
    LYRICS: 'bg-yellow-100 text-yellow-800',
    STORIES: 'bg-pink-100 text-pink-800',
    ESSAYS: 'bg-purple-100 text-purple-800',
  };

  return (
    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[type] || 'bg-gray-100 text-gray-800'}`}>
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-1 text-xs font-semibold rounded-full ${
        status === 'PUBLISHED'
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-800'
      }`}
    >
      {status}
    </span>
  );
}
