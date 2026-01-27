import type { Metadata } from "next";
import "./globals.css";
import "@fontsource-variable/inter";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/700.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Gemini Studio",
  description: "Local-first creative editor for building AI-assisted video timelines",
  applicationName: "Gemini Studio",
  icons: {
    icon: "/gemini-logo.png",
    apple: "/gemini-logo.png",
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
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
