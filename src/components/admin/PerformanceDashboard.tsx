'use client';

/**
 * Performance Dashboard Component
 *
 * Real-time monitoring of:
 * - Embedding cache performance
 * - System health metrics
 * - API response times
 * - Cost savings
 */

import { useEffect, useState } from 'react';
import { Activity, Zap, DollarSign, Clock, Database, TrendingUp } from 'lucide-react';

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: string;
  oldestEntry: number;
  newestEntry: number;
}

interface PerformanceData {
  cache: CacheStats;
  performance: {
    estimatedSavings: {
      apiCalls: number;
      timeSeconds: number;
      costUSD: number;
    };
    speedup: string;
  };
  recommendations: string[];
}

export function PerformanceDashboard() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/ai/cache-stats');
      if (!response.ok) throw new Error('Failed to fetch stats');

      const result = await response.json();
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const clearCache = async () => {
    if (!confirm('Are you sure you want to clear the embedding cache? This will temporarily slow down searches until the cache warms up again.')) {
      return;
    }

    try {
      const response = await fetch('/api/ai/cache-stats', {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to clear cache');

      await fetchStats();
      alert('Cache cleared successfully');
    } catch (err) {
      alert('Failed to clear cache: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-gray-600">Loading performance data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-xl border border-red-200 p-8">
        <p className="text-red-800 font-semibold">Error loading performance data</p>
        <p className="text-red-600 text-sm mt-2">{error}</p>
        <button
          onClick={fetchStats}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const totalRequests = data.cache.hits + data.cache.misses;
  const hitRateNum = totalRequests > 0 ? (data.cache.hits / totalRequests) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-7 h-7 text-purple-600" />
            Performance Metrics
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchStats}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          >
            Refresh
          </button>
          <button
            onClick={clearCache}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium"
          >
            Clear Cache
          </button>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Cache Hit Rate"
          value={hitRateNum.toFixed(1) + '%'}
          subtitle={`${data.cache.hits} hits / ${totalRequests} total`}
          icon={<TrendingUp className="w-6 h-6" />}
          color="bg-green-500"
          trend={hitRateNum > 80 ? 'excellent' : hitRateNum > 50 ? 'good' : 'needs-improvement'}
        />
        <MetricCard
          title="API Calls Saved"
          value={data.performance.estimatedSavings.apiCalls.toString()}
          subtitle="OpenAI API requests avoided"
          icon={<Zap className="w-6 h-6" />}
          color="bg-yellow-500"
        />
        <MetricCard
          title="Cost Savings"
          value={`$${data.performance.estimatedSavings.costUSD.toFixed(2)}`}
          subtitle="Estimated savings"
          icon={<DollarSign className="w-6 h-6" />}
          color="bg-blue-500"
        />
        <MetricCard
          title="Time Saved"
          value={`${Math.round(data.performance.estimatedSavings.timeSeconds / 60)}m`}
          subtitle={`${data.performance.estimatedSavings.timeSeconds.toFixed(1)}s total`}
          icon={<Clock className="w-6 h-6" />}
          color="bg-purple-500"
        />
      </div>

      {/* Cache Details */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-purple-600" />
          Embedding Cache Status
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">Cache Size</p>
            <p className="text-2xl font-bold text-gray-900">{data.cache.size}</p>
            <p className="text-xs text-gray-400 mt-1">entries (max 1000)</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Cache Hits</p>
            <p className="text-2xl font-bold text-green-600">{data.cache.hits}</p>
            <p className="text-xs text-gray-400 mt-1">served from cache</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Cache Misses</p>
            <p className="text-2xl font-bold text-orange-600">{data.cache.misses}</p>
            <p className="text-xs text-gray-400 mt-1">required API call</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
            <span>Cache utilization</span>
            <span>{((data.cache.size / 1000) * 100).toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-purple-700 transition-all duration-500"
              style={{ width: `${(data.cache.size / 1000) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Performance Insights */}
      {data.recommendations && data.recommendations.length > 0 && (
        <div className="bg-purple-50 rounded-xl border border-purple-200 p-6">
          <h3 className="text-lg font-semibold text-purple-900 mb-3">
            💡 Performance Insights
          </h3>
          <ul className="space-y-2">
            {data.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-2 text-purple-800">
                <span className="text-purple-600 mt-0.5">•</span>
                <span className="text-sm">{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Performance Stats */}
      <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl p-6 text-white">
        <h3 className="text-lg font-semibold mb-4">⚡ Speed Improvement</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-purple-200 text-sm mb-1">Without Cache</p>
            <p className="text-2xl font-bold">~50 seconds</p>
            <p className="text-purple-200 text-xs mt-1">for 100 poems search</p>
          </div>
          <div>
            <p className="text-purple-200 text-sm mb-1">With Cache</p>
            <p className="text-2xl font-bold">~100ms</p>
            <p className="text-purple-200 text-xs mt-1">
              {data.performance.speedup}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  trend?: 'excellent' | 'good' | 'needs-improvement';
}

function MetricCard({ title, value, subtitle, icon, color, trend }: MetricCardProps) {
  const trendColors = {
    excellent: 'border-green-500 bg-green-50',
    good: 'border-yellow-500 bg-yellow-50',
    'needs-improvement': 'border-orange-500 bg-orange-50',
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border-2 p-6 ${
        trend ? trendColors[trend] : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <div className={`${color} w-10 h-10 rounded-lg flex items-center justify-center text-white`}>
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}
