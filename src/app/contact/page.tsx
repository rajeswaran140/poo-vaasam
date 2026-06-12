/**
 * Contact Page
 */

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import ContactForm from '@/components/ContactForm';
import { SITE } from '@/config/site';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'தொடர்பு',
  description: 'தமிழகவல் தளத்தைத் தொடர்பு கொள்ளுங்கள் — கருத்துக்கள், பரிந்துரைகள், பங்களிப்புகள்.',
  alternates: alternatesFor('/contact'),
};

export default function ContactPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" className="flex-1">
        {/* Hero — matches the site's dark/orange brand */}
        <section className="relative bg-gray-900 text-white py-16">
          <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-500/70 to-transparent" />
          <div className="container mx-auto px-4">
            <h1 className="text-3xl sm:text-5xl font-bold mb-3 font-kavivanar">தொடர்பு</h1>
            <p className="text-xl text-gray-300 font-tamil">எங்களை தொடர்பு கொள்ளுங்கள்</p>
          </div>
        </section>

        {/* Content */}
        <div className="bg-gray-50 py-12">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              {/* Contact Info Section */}
              <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-6 font-tamil">எங்களை தொடர்பு கொள்ள</h2>
                <div className="space-y-6 text-gray-700 font-tamil">
                  <p className="text-lg">
                    தமிழகவல் தளம் பற்றிய உங்கள் கருத்துக்கள், பரிந்துரைகள் அல்லது வினாக்கள் இருந்தால்
                    எங்களை தொடர்பு கொள்ள தயங்க வேண்டாம்.
                  </p>

                  <p className="text-lg">
                    கீழே உள்ள படிவத்தின் மூலம் எங்களுக்கு செய்தி அனுப்புங்கள்.
                  </p>

                  <div className="space-y-4 mt-8">
                    <div className="flex items-start">
                      <div className="text-2xl mr-4">💬</div>
                      <div>
                        <h3 className="font-bold text-lg mb-1">சமூக வலைத்தளங்கள்</h3>
                        <a
                          href={SITE.facebook.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-[#1877F2] hover:underline"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                          </svg>
                          <span>Facebook</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Contact Form Section */}
              <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-2 font-tamil">செய்தி அனுப்புங்கள்</h2>
                <p className="text-gray-500 mb-6">Send us a message and we&apos;ll get back to you.</p>
                <ContactForm />
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
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 mt-6">
                    <h3 className="font-bold text-xl mb-3 text-orange-900">பங்களிப்பு வழிமுறைகள்:</h3>
                    <ul className="list-disc list-inside space-y-2 text-orange-900">
                      <li>மேலே உள்ள தொடர்பு படிவத்தின் மூலம் உங்கள் படைப்புகளை அனுப்பவும்</li>
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
      </main>
      <Footer />
    </div>
  );
}
