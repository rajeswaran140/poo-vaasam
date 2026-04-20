/**
 * Content List Page
 *
 * Shows all content with filtering and search
 */

import Link from 'next/link';

async function getContent(searchParams: any) {
  try {
    const params = new URLSearchParams();
    params.append('action', 'list');

    const response = await fetch(`http://localhost:3000/api/test/content?${params}`, {
      cache: 'no-store'
    });
    const data = await response.json();
    return data.success ? data.data.items : [];
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return [];
  }
}

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ContentListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const content = await getContent(params);

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
          <FilterButton label="All" active />
          <FilterButton label="Songs" />
          <FilterButton label="Poems" />
          <FilterButton label="Lyrics" />
          <FilterButton label="Stories" />
          <FilterButton label="Essays" />
          <div className="ml-auto">
            <select className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
              <option>All Status</option>
              <option>Published</option>
              <option>Draft</option>
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
                {content.map((item: any) => (
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
                        <button className="text-purple-600 hover:text-purple-900">
                          Edit
                        </button>
                        <button className="text-blue-600 hover:text-blue-900">
                          View
                        </button>
                        <button className="text-red-600 hover:text-red-900">
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
            Showing <span className="font-medium">{content.length}</span> results
          </p>
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              Previous
            </button>
            <button className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium">
              1
            </button>
            <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              2
            </button>
            <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
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
