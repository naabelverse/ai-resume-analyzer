import type { Metadata } from "next";

import { Header } from "@/components/layout/header";
import { HistoryList } from "@/components/dashboard/history-list";
import { Reveal } from "@/components/reveal";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Past analyses — AI Resume Analyzer",
};

export default function DashboardPage() {
  return (
    <main className="pb-20">
      <Header />

      <div className="shell">
        {/* Narrower than the shell the header and the upload page use. That
            width is there for the upload page's two columns; this page is one
            list, and stretched to 1160px every row ran a filename against the
            left edge and its actions against the right with ~270px of nothing
            between them. The constraint belongs to the card rather than to
            `.shell` so the upload page keeps the width it needs.

            The width is the `--shell-narrow` token rather than `max-w-3xl`
            because `<HeaderShell>` sizes the header from it too on this
            route, and the point of that is the two staying the same number.
            The card takes the bare token and the header takes it plus the
            shell padding it has and the card does not — see `.shell-narrow`. */}
        <Reveal index={0}>
          <Card className="mx-auto max-w-[var(--shell-narrow)]">
            <CardTitle>Past analyses</CardTitle>
            <CardDescription>
              Scores and filenames only. The resume itself is never stored.
            </CardDescription>
            <div className="mt-2">
              <HistoryList />
            </div>
          </Card>
        </Reveal>
      </div>
    </main>
  );
}
