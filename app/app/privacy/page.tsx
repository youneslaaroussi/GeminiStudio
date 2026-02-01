'use client';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0f0f12] via-[#0f0f12] to-[#1a1a1f]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-slate-800 bg-[#0f0f12]/95 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <a href="/" className="text-blue-400 hover:text-blue-300">← Back to Home</a>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-5xl font-bold text-white mb-12">Privacy Policy</h1>

        <div className="prose prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Introduction</h2>
            <p className="text-slate-300 leading-relaxed">
              GeminiStudio ("we", "us", "our", or "Company") operates the GeminiStudio website and application (the "Service"). This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service and the choices you have associated with that data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. Information Collection and Use</h2>
            <p className="text-slate-300 leading-relaxed mb-4">We collect several different types of information for various purposes to provide and improve our Service to you:</p>

            <h3 className="text-xl font-semibold text-white mb-3">Account Information</h3>
            <p className="text-slate-300 leading-relaxed mb-4">
              When you create an account, we collect your email address, name, and authentication information. This information is used to manage your account and provide access to the Service.
            </p>

            <h3 className="text-xl font-semibold text-white mb-3">Video and Media Files</h3>
            <p className="text-slate-300 leading-relaxed mb-4">
              Any video, audio, or image files you upload are stored securely and used solely for the purpose of creating edited videos according to your specifications. These files are processed by Google Cloud APIs and Gemini 3.
            </p>

            <h3 className="text-xl font-semibold text-white mb-3">Gemini API Usage</h3>
            <p className="text-slate-300 leading-relaxed mb-4">
              To provide video understanding and editing capabilities, we transmit video content to Google's Gemini 3 API. The use of your data by Google is subject to Google's Privacy Policy at https://policies.google.com/privacy.
            </p>

            <h3 className="text-xl font-semibold text-white mb-3">Usage Data</h3>
            <p className="text-slate-300 leading-relaxed">
              We may also collect information on how the Service is accessed and used ("Usage Data"). This may include information such as your computer's Internet Protocol address, browser type, browser version, the pages you visit, the time and date of your visit, and other diagnostic data.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. Data Security</h2>
            <p className="text-slate-300 leading-relaxed">
              The security of your data is important to us but remember that no method of transmission over the Internet or method of electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your personal data, we cannot guarantee its absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. Third-Party Services</h2>
            <p className="text-slate-300 leading-relaxed mb-4">
              Our Service may contain links to third-party websites and services that are not operated by us. We have no control over the content, policies, or practices of these websites and services. We strongly advise you to review their privacy policies before providing any personal information.
            </p>
            <p className="text-slate-300 leading-relaxed">
              GeminiStudio uses the following third-party services:
            </p>
            <ul className="list-disc list-inside text-slate-300 space-y-2 mt-3">
              <li>Google Gemini API</li>
              <li>Google Cloud Platform (GCS, Firestore, Pub/Sub)</li>
              <li>Firebase Authentication</li>
              <li>Stripe (for payments)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. Your Rights</h2>
            <p className="text-slate-300 leading-relaxed">
              You have the right to request access to, correction of, or deletion of your personal data. You may also have the right to data portability. To exercise these rights, please contact us at the email address provided below.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">6. Changes to This Policy</h2>
            <p className="text-slate-300 leading-relaxed">
              We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "effective date" below.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. Contact Us</h2>
            <p className="text-slate-300 leading-relaxed">
              If you have any questions about this Privacy Policy, please contact Younes Laaroussi at: hello@youneslaaroussi.ca
            </p>
          </section>

          <div className="border-t border-slate-800 pt-8 mt-12">
            <p className="text-slate-500 text-sm">
              Effective Date: January 31, 2026<br />
              Last Updated: January 31, 2026
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
