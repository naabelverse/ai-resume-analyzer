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

      <div className="shell max-w-[760px]">
        <Reveal index={0}>
          <Card>
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
