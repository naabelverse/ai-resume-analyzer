import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { FeedbackLink } from "@/components/feedback/feedback-link";

// Body/UI face. Bound to --font-inter, consumed by --font-sans in globals.css.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Display face. Weight 800 only — headings never render lighter.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Resume Analyzer",
  description: "Get AI-powered feedback to improve your resume",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jakarta.variable} h-full antialiased`}
    >
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
