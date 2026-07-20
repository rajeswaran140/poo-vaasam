/**
 * Contact Page
 */

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import ContactForm from '@/components/ContactForm';
import { SITE, isFacebookConfigured, isInstagramConfigured, isWhatsAppConfigured } from '@/config/site';
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
                        <div className="flex flex-col gap-2">
                          {isFacebookConfigured() && (
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
                          )}
                          {isInstagramConfigured() && (
                            <a
                              href={SITE.instagram.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-[#E4405F] hover:underline"
                            >
                              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                              </svg>
                              <span>Instagram</span>
                            </a>
                          )}
                          {isWhatsAppConfigured() && (
                            <a
                              href={SITE.whatsapp.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-[#25D366] hover:underline"
                            >
                              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                              </svg>
                              <span>WhatsApp</span>
                            </a>
                          )}
                        </div>
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
                      <li>படைப்புகள் மதிப்பாய்வு செய்யப்பட்டு சேர்க்கப்படும்</li>
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
