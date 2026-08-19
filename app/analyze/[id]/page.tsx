import { Header } from "@/components/layout/header";
import { AnalysisView } from "@/components/analysis/analysis-view";

/**
 * Server shell around the client view: `params` is awaited here so the client
 * component takes a plain string rather than unwrapping a promise of its own.
 */
export default async function AnalyzePage({ params }: PageProps<"/analyze/[id]">) {
  const { id } = await params;

  return (
    <main className="pb-20">
      <Header />
      <div className="shell">
        <AnalysisView id={id} />
      </div>
    </main>
  );
}
