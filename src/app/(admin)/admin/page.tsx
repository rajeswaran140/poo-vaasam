/**
 * Admin Dashboard Page
 *
 * Overview of content statistics and recent activity
 */

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';

async function getStats() {
  try {
    const repo = new ContentRepository();
    const [songs, poems, lyrics, stories, essays, published, draft] = await Promise.all([
      repo.countByType(ContentType.SONGS),
      repo.countByType(ContentType.POEMS),
      repo.countByType(ContentType.LYRICS),
      repo.countByType(ContentType.STORIES),
      repo.countByType(ContentType.ESSAYS),
      repo.countByStatus(ContentStatus.PUBLISHED),
      repo.countByStatus(ContentStatus.DRAFT),
    ]);

    return {
      songs,
      poems,
      lyrics,
      stories,
      essays,
      published,
      draft,
    };
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return null;
  }
}

async function getRecentContent() {
  try {
    const repo = new ContentRepository();
    const result = await repo.findAll({ limit: 10 });
    return result.items.map(item => item.toObject());
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return [];
  }
}

export default async function AdminDashboard() {
  const stats = await getStats();
  const recentContent = await getRecentContent();

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-800 rounded-xl p-8 text-white">
        <h1 className="text-3xl font-bold mb-2">வணக்கம்! Welcome Back</h1>
        <p className="text-purple-100">
          Manage your Tamil content platform from here
        </p>
      </div>

      {/* Statistics Cards */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Content Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Songs"
            value={stats?.songs || 0}
            icon="🎵"
            color="bg-blue-500"
            href="/admin/content?type=SONGS"
          />
          <StatCard
            title="Poems"
            value={stats?.poems || 0}
            icon="📝"
            color="bg-green-500"
            href="/admin/content?type=POEMS"
          />
          <StatCard
            title="Lyrics"
            value={stats?.lyrics || 0}
            icon="🎤"
            color="bg-yellow-500"
            href="/admin/content?type=LYRICS"
          />
          <StatCard
            title="Stories"
            value={stats?.stories || 0}
            icon="📖"
            color="bg-pink-500"
            href="/admin/content?type=STORIES"
          />
        </div>
      </div>

      {/* Status Cards */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Status Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="Published"
            value={stats?.published || 0}
            icon="✅"
            color="bg-green-600"
            href="/admin/content?status=PUBLISHED"
          />
          <StatCard
            title="Drafts"
            value={stats?.draft || 0}
            icon="📄"
            color="bg-gray-500"
            href="/admin/content?status=DRAFT"
          />
          <StatCard
            title="Total Content"
            value={(stats?.published || 0) + (stats?.draft || 0)}
            icon="📊"
            color="bg-purple-600"
            href="/admin/content"
          />
        </div>
      </div>

      {/* Recent Content */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            Recent Content
          </h2>
          <Link
            href="/admin/content"
            className="text-purple-600 hover:text-purple-700 font-medium"
          >
            View All →
          </Link>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {recentContent.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-lg">No content yet</p>
              <p className="text-sm mt-2">
                Start by creating your first content item
              </p>
              <Link
                href="/admin/content/new"
                className="inline-block mt-4 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Create Content
              </Link>
            </div>
          ) : (
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
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentContent.slice(0, 5).map((content: any) => (
                  <tr
                    key={content.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 font-tamil">
                        {content.title}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        {content.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-tamil">
                      {content.author}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          content.status === 'PUBLISHED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {content.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {content.viewCount || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ActionCard
            title="Create Content"
            description="Add new songs, poems, or stories"
            icon="📝"
            href="/admin/content/new"
            color="bg-purple-600"
          />
          <ActionCard
            title="Manage Categories"
            description="Organize content into categories"
            icon="📚"
            href="/admin/categories"
            color="bg-blue-600"
          />
          <ActionCard
            title="Manage Tags"
            description="Add and edit content tags"
            icon="🏷️"
            href="/admin/tags"
            color="bg-green-600"
          />
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  icon: string;
  color: string;
  href: string;
}

function StatCard({ title, value, icon, color, href }: StatCardProps) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`${color} w-12 h-12 rounded-lg flex items-center justify-center text-2xl`}>
          {icon}
        </div>
      </div>
    </Link>
  );
}

interface ActionCardProps {
  title: string;
  description: string;
  icon: string;
  href: string;
  color: string;
}

function ActionCard({ title, description, icon, href, color }: ActionCardProps) {
  return (
    <Link
      href={href}
      className={`${color} rounded-xl p-6 text-white hover:opacity-90 transition-opacity`}
    >
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-sm text-white/80">{description}</p>
    </Link>
  );
}
