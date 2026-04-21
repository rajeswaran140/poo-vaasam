/**
 * Contact Page
 */

import Link from 'next/link';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-600 to-purple-700 text-white py-16">
        <div className="container mx-auto px-4">
          <Link href="/" className="text-purple-100 hover:text-white mb-4 inline-block font-tamil">
            ← முகப்புக்குத் திரும்பு
          </Link>
          <h1 className="text-5xl font-bold mb-4 font-tamil">தொடர்பு</h1>
          <p className="text-xl text-purple-100 font-tamil">எங்களை தொடர்பு கொள்ளுங்கள்</p>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Contact Info Section */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">எங்களை தொடர்பு கொள்ள</h2>
            <div className="space-y-6 text-gray-700 font-tamil">
              <p className="text-lg">
                தமிழகவல் தளம் பற்றிய உங்கள் கருத்துக்கள், பரிந்துரைகள் அல்லது வினாக்கள் இருந்தால்
                எங்களை தொடர்பு கொள்ள தயங்க வேண்டாம்.
              </p>

              <div className="space-y-4 mt-8">
                <div className="flex items-start">
                  <div className="text-2xl mr-4">📧</div>
                  <div>
                    <h3 className="font-bold text-lg mb-1">மின்னஞ்சல்</h3>
                    <p className="text-purple-600">info@tamilagaval.com</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="text-2xl mr-4">💬</div>
                  <div>
                    <h3 className="font-bold text-lg mb-1">சமூக வலைத்தளங்கள்</h3>
                    <p>விரைவில் வரவுள்ளது...</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Contribution Section */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">பங்களிக்க விரும்புகிறீர்களா?</h2>
            <div className="space-y-4 text-gray-700 font-tamil">
              <p className="text-lg">
                நீங்கள் ஒரு எழுத்தாளர், கவிஞர் அல்லது தமிழ் இலக்கிய ஆர்வலர் என்றால்,
                உங்கள் படைப்புகளை எங்கள் தளத்தில் பகிர்ந்து கொள்ள விரும்பினால்
                எங்களை தொடர்பு கொள்ளுங்கள்.
              </p>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 mt-6">
                <h3 className="font-bold text-xl mb-3 text-purple-900">பங்களிப்பு வழிமுறைகள்:</h3>
                <ul className="list-disc list-inside space-y-2 text-purple-900">
                  <li>உங்கள் படைப்புகளை மின்னஞ்சல் மூலம் அனுப்பவும்</li>
                  <li>ஆசிரியர் பெயர் மற்றும் தொடர்பு விவரங்களை சேர்க்கவும்</li>
                  <li>அசல் படைப்புகள் மட்டுமே ஏற்கப்படும்</li>
                  <li>படைப்புகள் எங்கள் குழுவினால் மதிப்பாய்வு செய்யப்படும்</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Feedback Section */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">கருத்துக்கள் மற்றும் பரிந்துரைகள்</h2>
            <div className="space-y-4 text-gray-700 font-tamil">
              <p className="text-lg">
                தளத்தை மேம்படுத்த உங்கள் கருத்துக்கள் மற்றும் பரிந்துரைகள் எங்களுக்கு மிகவும் முக்கியம்.
                தயவுசெய்து உங்கள் கருத்துக்களை எங்களுடன் பகிர்ந்து கொள்ளுங்கள்.
              </p>
              <div className="flex items-start mt-6 bg-gray-50 rounded-lg p-6">
                <div className="text-3xl mr-4">💡</div>
                <div>
                  <h3 className="font-bold text-lg mb-2">உங்கள் யோசனைகளை பகிருங்கள்</h3>
                  <p>
                    புதிய அம்சங்கள், மேம்பாடுகள் அல்லது வேறு ஏதேனும் யோசனைகள் இருந்தால்
                    எங்களுக்கு தெரியப்படுத்துங்கள்.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
