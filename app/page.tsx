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

      {/*
        Full shell width, matching the header. A narrower max-width re-centres
        the box, putting its left edge somewhere the header's is not — the
        offset reads as an accident and the leftover space reads as an empty
        page. The card earns the width with a two-column interior.
      */}
      <div className="shell">
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
      </div>
    </main>
  );
}
