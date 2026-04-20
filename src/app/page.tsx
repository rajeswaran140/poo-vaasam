export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <main className="max-w-4xl mx-auto text-center space-y-8">
        <h1 className="text-5xl md:text-7xl font-bold text-gray-900 dark:text-gray-100">
          பூ வாசம்
        </h1>

        <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400">
          தமிழ் இலக்கிய உள்ளடக்க வெளியீட்டு தளம்
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-3">பாடல்கள்</h2>
            <p className="text-gray-600 dark:text-gray-400">
              தமிழ் பாடல் வரிகள் மற்றும் இசை
            </p>
          </div>

          <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-3">கவிதைகள்</h2>
            <p className="text-gray-600 dark:text-gray-400">
              தமிழ் கவிதைகள் மற்றும் செய்யுள்கள்
            </p>
          </div>

          <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-3">கதைகள்</h2>
            <p className="text-gray-600 dark:text-gray-400">
              சிறுகதைகள் மற்றும் கட்டுரைகள்
            </p>
          </div>
        </div>

        <div className="mt-12 text-sm text-gray-500 dark:text-gray-400">
          <p>Phase 1: Foundation Setup Complete ✓</p>
          <p className="mt-2">Next.js 15 + TypeScript + Tailwind CSS + Tamil Fonts</p>
        </div>
      </main>
    </div>
  );
}
