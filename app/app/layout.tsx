import type { Metadata } from "next";
import "./globals.css";
// Variable fonts
import "@fontsource-variable/inter";
import "@fontsource-variable/open-sans";
import "@fontsource-variable/montserrat";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/noto-sans";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/mulish";
import "@fontsource-variable/nunito-sans";
import "@fontsource-variable/nunito";
import "@fontsource-variable/merriweather";
import "@fontsource-variable/roboto";
import "@fontsource-variable/work-sans";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/manrope";
import "@fontsource-variable/outfit";
import "@fontsource-variable/raleway";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/crimson-pro";
import "@fontsource-variable/literata";
import "@fontsource-variable/vollkorn";
import "@fontsource-variable/lora";
import "@fontsource-variable/jetbrains-mono";
// Regular fonts (400, 500, 700)
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/500.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/raleway/400.css";
import "@fontsource/raleway/500.css";
import "@fontsource/raleway/700.css";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "@fontsource/ubuntu/400.css";
import "@fontsource/ubuntu/500.css";
import "@fontsource/ubuntu/700.css";
import "@fontsource/cabin/400.css";
import "@fontsource/cabin/500.css";
import "@fontsource/cabin/700.css";
import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/700.css";
import "@fontsource/comfortaa/400.css";
import "@fontsource/comfortaa/500.css";
import "@fontsource/comfortaa/700.css";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "@fontsource/pacifico/400.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/700.css";
import "@fontsource/anton/400.css";
import "@fontsource/righteous/400.css";
import "@fontsource/lobster/400.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/dancing-script/500.css";
import "@fontsource/dancing-script/700.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/700.css";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/source-sans-pro/400.css";
import "@fontsource/source-sans-pro/700.css";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/700.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/mulish/400.css";
import "@fontsource/mulish/500.css";
import "@fontsource/mulish/700.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/500.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/500.css";
import "@fontsource/nunito-sans/700.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/500.css";
import "@fontsource/merriweather/700.css";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/crimson-pro/400.css";
import "@fontsource/crimson-pro/500.css";
import "@fontsource/crimson-pro/700.css";
import "@fontsource/literata/400.css";
import "@fontsource/literata/500.css";
import "@fontsource/literata/700.css";
import "@fontsource/libre-baskerville/400.css";
import "@fontsource/libre-baskerville/500.css";
import "@fontsource/libre-baskerville/700.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/500.css";
import "@fontsource/spectral/700.css";
import "@fontsource/crimson-text/400.css";
import "@fontsource/crimson-text/700.css";
import "@fontsource/vollkorn/400.css";
import "@fontsource/vollkorn/500.css";
import "@fontsource/vollkorn/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/700.css";
import "@fontsource/alegreya/400.css";
import "@fontsource/alegreya/500.css";
import "@fontsource/alegreya/700.css";
import "@fontsource/cormorant/400.css";
import "@fontsource/cormorant/500.css";
import "@fontsource/cormorant/700.css";
import "@fontsource/pt-serif/400.css";
import "@fontsource/pt-serif/700.css";
import { Toaster } from "@/components/ui/sonner";
import { Copyright } from "@/app/components/Copyright";
import { CookieNotice } from "@/app/components/CookieNotice";
import { AnalyticsProvider } from "@/app/lib/analytics/AnalyticsProvider";

export const metadata: Metadata = {
  title: "Gemini Studio",
  description: "Local-first creative editor for building AI-assisted video timelines",
  applicationName: "Gemini Studio",
  keywords: [
    "video editing",
    "AI video editor",
    "agentic video",
    "Gemini Studio",
    "AI-assisted editing",
    "video production",
    "automated video editing",
    "semantic video editing",
    "Gemini 3 Pro",
    "LangGraph",
    "Motion Canvas",
    "video timeline editor",
    "AI video generation",
    "Veo 3",
    "video creation",
    "video automation",
  ],
  authors: [{ name: "Younes Laaroussi" }],
  creator: "Younes Laaroussi",
  publisher: "Younes Laaroussi",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/gemini-logo.png",
    apple: "/gemini-logo.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.geminivideo.studio",
    siteName: "Gemini Studio",
    title: "Gemini Studio - The Execution Layer for Agentic Video",
    description: "Local-first creative editor for building AI-assisted video timelines. The deterministic engine that gives AI agents the hands to edit video.",
    images: [
      {
        url: "https://www.geminivideo.studio/GeminiStudio_Banner_Full.png",
        width: 1200,
        height: 630,
        alt: "Gemini Studio - The Execution Layer for Agentic Video",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gemini Studio - The Execution Layer for Agentic Video",
    description: "Local-first creative editor for building AI-assisted video timelines",
    images: ["https://www.geminivideo.studio/GeminiStudio_Banner_Full.png"],
    creator: "@geministudio",
  },
  alternates: {
    canonical: "https://www.geminivideo.studio",
  },
  other: {
    "preload:inter": `<link rel="preload" href="/fonts/inter-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Gemini Studio",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description: "Local-first creative editor for building AI-assisted video timelines. The deterministic engine that gives AI agents the hands to edit video.",
    url: "https://www.geminivideo.studio",
    author: {
      "@type": "Person",
      name: "Younes Laaroussi",
      url: "https://github.com/youneslaaroussi/geministudio",
      email: "hello@youneslaaroussi.ca",
    },
    featureList: [
      "AI-assisted video editing",
      "Semantic asset understanding",
      "Agentic video production",
      "Git-style branching for video",
      "Real-time collaboration",
      "Automated video generation",
    ],
    keywords: "video editing, AI video editor, agentic video, Gemini Studio, AI-assisted editing, video production",
    screenshot: "https://www.geminivideo.studio/GeminiStudio_Banner_Full.png",
  };

  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-background text-foreground">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <AnalyticsProvider>
          {children}
          <Copyright />
          <CookieNotice />
          <Toaster />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
