import type { Metadata } from "next";
import { preload } from "react-dom";
import "./globals.css";

import { FeedbackLink } from "@/components/feedback/feedback-link";

// Fonts are self-hosted from public/fonts and declared in globals.css. Only the
// latin slices are preloaded, as next/font did: every page renders them, while
// the other scripts download through unicode-range only when text needs them.
const PRELOADED_FONTS = [
  "/fonts/inter-latin.v1.woff2",
  "/fonts/plus-jakarta-sans-latin.v1.woff2",
];

export const metadata: Metadata = {
  title: "AI Resume Analyzer",
  description: "Get AI-powered feedback to improve your resume",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  for (const href of PRELOADED_FONTS) {
    // Fonts are always fetched in CORS mode, so a preload without crossOrigin
    // would not match the real request and the file would download twice.
    preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }

  return (
    <html lang="en" className="h-full antialiased">
      {/*
        The feedback trigger is mounted here rather than in each page, so a
        route added later gets it without anyone remembering to. It sits after
        `{children}` — below `main`'s own `pb-20` and past every primary action
        on every page — which is the whole of how it stays out of the way. See
        `<FeedbackLink>` for why it is not in the header.

        This layout stays a server component: the client boundary is that
        component, the same way `<HeaderShell>` carries it for the header.
      */}
      <body className="min-h-full">
        {children}
        <FeedbackLink />
      </body>
    </html>
  );
}
