import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Gemini Studio",
  description: "Local-first creative editor for building AI-assisted video timelines",
  applicationName: "Gemini Studio",
  icons: {
    icon: "/gemini-logo.png",
    apple: "/gemini-logo.png",
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
