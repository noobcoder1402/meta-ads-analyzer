import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meta Ads Analyzer",
  description:
    "Competitor intelligence tool — scrape Meta Ad Library, analyze creative with AI, get GTM recommendations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>
          <Nav />
          <main className="flex-1 mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}

function Nav() {
  const isDemoMode = process.env.DEMO_MODE === "true";

  return (
    <>
      {isDemoMode && (
        <div className="bg-chart-1/20 text-chart-1 text-sm text-center py-2 px-4">
          You&apos;re viewing the live demo with cached data.{" "}
          <a
            href="https://github.com/anthropics/meta-ads-analyzer"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium"
          >
            Clone on GitHub &rarr;
          </a>
        </div>
      )}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center px-4 sm:px-6 lg:px-8">
          <Link href="/competitors" className="flex items-center gap-2 font-semibold">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
            Meta Ads Analyzer
          </Link>
          <nav className="ml-8 flex items-center gap-6 text-sm">
            <Link href="/competitors" className="text-muted-foreground hover:text-foreground transition-colors">
              Competitors
            </Link>
            <Link href="/insights" className="text-muted-foreground hover:text-foreground transition-colors">
              Insights
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
