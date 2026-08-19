import Link from "next/link";
import { ArrowRight, History } from "lucide-react";

import { Header } from "@/components/layout/header";
import { Reveal } from "@/components/reveal";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { AnalyzeForm } from "@/components/upload/analyze-form";

/**
 * Stays a server component: the header and card shell render immediately and
 * only `<AnalyzeForm>` ships JavaScript.
 */
export default function HomePage() {
  return (
    <main className="pb-20">
      <Header />

      <div className="shell max-w-[680px]">
        <Reveal index={0}>
          <Card>
            <CardTitle>Upload your resume</CardTitle>
            <CardDescription>
              PDF or DOCX. Nothing is stored — your file is discarded once the
              text has been read.
            </CardDescription>

            <div className="mt-5">
              <AnalyzeForm />
            </div>
          </Card>
        </Reveal>

        <Reveal index={1}>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center text-sm text-ink-soft">
            {/*
              Kept deliberately: it lets someone read the results layout without
              an API key, which is the first thing a reviewer of this project
              wants to do.
            */}
            <Link
              href="/analyze/demo"
              className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline"
            >
              Preview the results layout
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline"
            >
              <History className="size-3.5" aria-hidden="true" />
              Past analyses
            </Link>
          </p>
        </Reveal>
      </div>
    </main>
  );
}
