/**
 * About Page
 */

import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-600 to-purple-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link href="/" className="text-purple-100 hover:text-white mb-4 inline-block font-tamil">
            ← முகப்புக்குத் திரும்புங்கள்
          </Link>
          <h1 className="text-5xl font-bold mb-4 font-tamil">எங்களை பற்றி</h1>
          <p className="text-xl text-purple-100 font-tamil">தமிழகவல் - தமிழ் இலக்கிய தளம்</p>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* About Section */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">தமிழகவல் பற்றி</h2>
            <div className="space-y-4 text-gray-700 font-tamil leading-relaxed">
              <p className="text-lg">
                தமிழகவல் என்பது தமிழ் இலக்கியத்தை பாதுகாக்கவும், பரப்பவும் உருவாக்கப்பட்ட ஒரு தளமாகும்.
                இங்கு நீங்கள் பாடல்கள், கவிதைகள், கதைகள், மற்றும் கட்டுரைகள் போன்ற பல்வேறு தமிழ்
                இலக்கிய படைப்புகளை காணலாம்.
              </p>
              <p className="text-lg">
                நமது குறிக்கோள் தமிழ் மொழியின் வளமையையும், இலக்கியத்தின் அழகையும் எல்லோருக்கும்
                எளிதாக கிடைக்கச் செய்வதாகும்.
              </p>
            </div>
          </section>

          {/* Mission Section */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">நமது நோக்கம்</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-start">
                <div className="text-3xl mr-4">📚</div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2 font-tamil">பாதுகாப்பு</h3>
                  <p className="text-gray-700 font-tamil">
                    தமிழ் இலக்கியத்தை டிஜிட்டல் வடிவில் பாதுகாத்தல்
                  </p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="text-3xl mr-4">🌍</div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2 font-tamil">பரப்புதல்</h3>
                  <p className="text-gray-700 font-tamil">
                    தமிழ் இலக்கியத்தை உலகம் முழுவதும் பரப்புதல்
                  </p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="text-3xl mr-4">✍️</div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2 font-tamil">ஊக்குவித்தல்</h3>
                  <p className="text-gray-700 font-tamil">
                    புதிய எழுத்தாளர்களை ஊக்குவித்தல்
                  </p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="text-3xl mr-4">🤝</div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2 font-tamil">இணைத்தல்</h3>
                  <p className="text-gray-700 font-tamil">
                    தமிழ் இலக்கிய சமூகத்தை இணைத்தல்
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Content Types */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">நமது உள்ளடக்கம்</h2>
            <div className="space-y-4 text-gray-700 font-tamil">
              <div className="flex items-center">
                <span className="text-2xl mr-3">🎵</span>
                <div>
                  <h3 className="font-bold text-lg">பாடல்கள்</h3>
                  <p>தமிழ் திரைப்பட பாடல்கள் மற்றும் பாரம்பரிய பாடல்கள்</p>
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-2xl mr-3">📝</span>
                <div>
                  <h3 className="font-bold text-lg">கவிதைகள்</h3>
                  <p>நவீன மற்றும் பாரம்பரிய தமிழ் கவிதைகள்</p>
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-2xl mr-3">📖</span>
                <div>
                  <h3 className="font-bold text-lg">கதைகள்</h3>
                  <p>சிறுகதைகள், புராணக் கதைகள், மற்றும் நாட்டுப்புற கதைகள்</p>
                </div>
              </div>
              <div className="flex items-center">
                <span className="text-2xl mr-3">✍️</span>
                <div>
                  <h3 className="font-bold text-lg">கட்டுரைகள்</h3>
                  <p>தமிழ் இலக்கியம், கலாச்சாரம் மற்றும் வரலாறு பற்றிய கட்டுரைகள்</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
