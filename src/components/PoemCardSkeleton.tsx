export function PoemCardSkeleton() {
  return (
    <div className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-pulse">
      {/* Image Skeleton */}
      <div className="w-full aspect-video bg-gray-200" />

      {/* Content Skeleton */}
      <div className="flex-1 flex flex-col p-4 sm:p-6">
        {/* Title Skeleton */}
        <div className="h-6 bg-gray-200 rounded mb-3 w-3/4" />
        <div className="h-6 bg-gray-200 rounded mb-3 w-1/2" />

        {/* Description Skeleton */}
        <div className="space-y-2 mb-4">
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>

        {/* Tags Skeleton */}
        <div className="flex gap-1.5 mb-4">
          <div className="h-5 w-16 bg-gray-200 rounded-full" />
          <div className="h-5 w-20 bg-gray-200 rounded-full" />
          <div className="h-5 w-14 bg-gray-200 rounded-full" />
        </div>

        {/* Author & Meta Skeleton */}
        <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
          <div className="h-4 bg-gray-200 rounded w-24" />
          <div className="h-4 bg-gray-200 rounded w-16" />
        </div>
      </div>
    </div>
  );
}

export function PoemsGridSkeleton() {
  return (
    <div className="space-y-6">
      {/* Search Bar Skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 h-11 bg-gray-200 rounded-lg animate-pulse" />
          <div className="flex gap-2">
            <div className="w-28 h-11 bg-gray-200 rounded-lg animate-pulse" />
            <div className="w-32 h-11 bg-gray-200 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {[...Array(6)].map((_, i) => (
          <PoemCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
