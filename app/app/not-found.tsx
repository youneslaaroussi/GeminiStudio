import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "404 - Page Not Found | Gemini Studio",
  description: "The page you are looking for could not be found.",
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Minimal header for brand consistency */}
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
          <Link
            href="/"
            className="flex items-center gap-3 text-foreground hover:opacity-90 transition-opacity"
          >
            <Image
              src="/gemini-logo.png"
              alt="Gemini Studio"
              width={28}
              height={28}
              className="size-7"
            />
            <span className="font-semibold text-base">Gemini Studio</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">
            Error 404
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3">
            Page not found
          </h1>
          <p className="text-muted-foreground text-base mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="gap-2">
              <Link href="/">
                <Home className="size-4" />
                Return home
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
