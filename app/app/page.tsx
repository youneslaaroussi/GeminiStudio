'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  MessageSquare,
  Mic,
  Sparkles,
  GitBranch,
  Captions,
  Music,
  Video,
  ImageIcon,
} from 'lucide-react';
import {
  SiTelegram,
  SiYoutube,
  SiTiktok,
  SiInstagram,
  SiX,
  SiGithub,
  SiGooglegemini,
  SiGooglecloud,
} from 'react-icons/si';
import { TypeAnimation } from 'react-type-animation';
import { useAuth } from '@/app/lib/hooks/useAuth';
import { RainbowGlow } from '@/components/landing/rainbow-glow';
import { GradientCtaButtonAsButton } from '@/components/landing/gradient-cta-button';

export default function LandingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [prompt, setPrompt] = useState('');

  const handleGetStarted = () => {
    router.push(user ? '/app' : '/auth/login');
  };

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push('/auth/login');
  };

  return (
    <div className="min-h-screen bg-[#0f0f12] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800 bg-[#0f0f12]/95 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/gemini-logo.png"
              alt="Gemini Studio"
              className="size-7"
            />
            <span className="font-semibold text-base">Gemini Studio</span>
          </div>
          <GradientCtaButtonAsButton
            onClick={handleGetStarted}
            disabled={authLoading}
            className="shrink-0"
          >
            {authLoading ? '…' : user ? 'Open app' : 'Sign in'}
          </GradientCtaButtonAsButton>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        <RainbowGlow position="top" />
        <div className="max-w-3xl mx-auto relative z-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.15] mb-6">
            <TypeAnimation
              sequence={[
                'Describe your edit.',
                2000,
                'Vibe editing.',
                2000,
                'Skip the tutorial.',
                2000,
                'Talk to your timeline.',
                2000,
                'Direct from your couch.',
                2000,
                'Think it. Ship it.',
                2000,
                'No more clicking around.',
                2000,
                'Post-production telepathy.',
                2000,
                'Video Editing at the Speed of Thought.',
                2000,
              ]}
              wrapper="span"
              speed={50}
              repeat={Infinity}
            />
            <br />
            <span className="inline-flex items-center gap-2 align-baseline" style={{ transform: 'translateY(0.05em)' }}>
              <img src="/gemini-logo.png" alt="" className="h-[0.85em] w-auto object-contain" aria-hidden />
              <span>Gemini</span>
            </span>
            {' '}builds it.
          </h1>

          <p className="text-lg text-slate-200 max-w-xl mb-10 leading-relaxed">
            Stop clicking through menus. Tell{' '}
            <span className="inline-flex items-center gap-1.5 align-baseline pl-0.5" style={{ transform: 'translateY(3px)' }}>
              <img src="/gemini-logo.png" alt="" className="h-[1em] w-auto object-contain" aria-hidden />
              <span>Gemini</span>
            </span>
            {' '}what you want—cuts, captions,
            transitions, effects—and watch your timeline update instantly.
          </p>

          {/* Inline CTA */}
          <form onSubmit={handlePromptSubmit} className="max-w-lg mb-4">
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-slate-600 transition-colors">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Cut to the beat and add captions..."
                className="flex-1 bg-transparent px-4 py-3.5 text-white placeholder-slate-500 text-sm focus:outline-none"
              />
              <button
                type="submit"
                className="m-1.5 px-4 py-2 bg-white hover:bg-slate-200 text-slate-900 text-sm font-medium rounded-md transition-colors flex items-center gap-2"
              >
                Start editing
                <ArrowRight className="size-4" />
              </button>
            </div>
          </form>

        </div>
      </section>

      {/* Powered by */}
      <section className="py-12 px-6 border-t border-slate-800/50">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-6">Powered by</p>
          <div className="flex flex-wrap gap-3">
            {[
              {
                name: 'Gemini 3 Pro',
                icon: SiGooglegemini,
                href: 'https://ai.google.dev/gemini',
              },
              {
                name: 'Veo 3.1',
                icon: Video,
                href: 'https://deepmind.google/technologies/veo/',
              },
              {
                name: 'Lyria',
                icon: Music,
                href: 'https://ai.google.dev/gemini-api/docs/music-generation',
              },
              {
                name: 'Google Cloud TTS',
                icon: SiGooglecloud,
                href: 'https://cloud.google.com/text-to-speech',
              },
              {
                name: 'Nano Banana Pro',
                icon: ImageIcon,
                href: 'https://ai.google.dev/gemini-api/docs/image-generation',
              },
              {
                name: 'Chirp',
                icon: Mic,
                href: 'https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd',
              },
            ].map(({ name, icon: Icon, href }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 bg-slate-800/50 border border-slate-700/50 rounded-md hover:border-slate-600 hover:text-white transition-colors"
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {name}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section className="py-12 px-6 border-t border-slate-800/50">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-6">Integrations</p>
          <div className="flex flex-wrap gap-3">
            {[
              { name: 'Telegram', icon: SiTelegram, comingSoon: false },
              { name: 'YouTube', icon: SiYoutube, comingSoon: true },
              { name: 'TikTok', icon: SiTiktok, comingSoon: true },
              { name: 'Instagram', icon: SiInstagram, comingSoon: true },
              { name: 'X / Twitter', icon: SiX, comingSoon: true },
            ].map(({ name, icon: Icon, comingSoon }) => (
              <span
                key={name}
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md ${
                  comingSoon
                    ? 'text-slate-500 bg-slate-800/30 border border-slate-700/30'
                    : 'text-slate-300 bg-slate-800/50 border border-slate-700/50'
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {name}
                {comingSoon && (
                  <span className="text-xs text-slate-500 font-medium">Coming soon</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 border-t border-slate-800/50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-semibold mb-12">
            What you can do
          </h2>

          <div className="grid sm:grid-cols-2 gap-x-12 gap-y-10">
            {[
              {
                icon: MessageSquare,
                title: 'Chat to edit',
                description: 'Type what you want in plain English. "Make the intro shorter" or "add a zoom transition here."',
              },
              {
                icon: Mic,
                title: 'Voice control',
                description: 'Talk to Gemini Live while previewing. Hands-free editing with real-time feedback.',
              },
              {
                icon: Captions,
                title: 'Auto captions',
                description: 'Transcribe and style captions automatically. Supports trending formats and animations.',
              },
              {
                icon: Music,
                title: 'Beat sync',
                description: 'Drop in a track and let AI cut your footage to the rhythm. Works with any music.',
              },
              {
                icon: Sparkles,
                title: 'AI effects',
                description: 'Background removal, object tracking, style transfer. Describe the effect, get the result.',
              },
              {
                icon: GitBranch,
                title: 'Version history',
                description: 'Every edit is saved. Branch off, compare versions, and revert anytime.',
              },
            ].map((feature, i) => (
              <div key={i} className="flex gap-4">
                <div className="shrink-0 size-9 rounded-lg bg-slate-800 flex items-center justify-center">
                  <feature.icon className="size-4 text-slate-300" />
                </div>
                <div>
                  <h3 className="font-medium mb-1">{feature.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 border-t border-slate-800/50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-semibold mb-4">
            Ready to try it?
          </h2>
          <p className="text-slate-400 mb-8">
            Create your first AI-edited video in minutes.
          </p>
          <button
            onClick={handleGetStarted}
            className="inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-slate-200 text-slate-900 font-medium rounded-lg transition-colors"
          >
            Get started free
            <ArrowRight className="size-4" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 sm:py-8 px-4 sm:px-6 border-t border-slate-800 mb-12">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1 text-sm text-slate-500 text-center sm:text-left">
            <img
              src="/gemini-logo.png"
              alt="Gemini Studio"
              className="size-5 shrink-0"
            />
            <span>Gemini Studio</span>
            <span>by</span>
            <a
              href="https://youneslaaroussi.ca/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              Younes Laaroussi
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-x-4 gap-y-2 sm:gap-x-6 text-sm text-slate-500 text-center sm:text-left">
            <a
              href="https://github.com/youneslaaroussi/GeminiStudio"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-slate-300 transition-colors"
              aria-label="GitHub repository"
            >
              <SiGithub className="size-4 shrink-0" aria-hidden />
              GitHub
            </a>
            <a href="/privacy" className="hover:text-slate-300 transition-colors">Privacy</a>
            <a href="/tos" className="hover:text-slate-300 transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
