import type { AnalysisRecord, AnalysisSummary } from "@/types";

/**
 * The persistence seam.
 *
 * Components never touch storage directly — they go through this interface, so
 * swapping sessionStorage for a database is a change to one module and zero
 * components. That is the whole reason it exists this early: the session
 * implementation is the only one v1 needs, but writing the interface first is
 * what made the database version a drop-in rather than a rewrite.
 *
 * Every method is async even where the session implementation is synchronous.
 * A synchronous interface would have forced the database version to lie about
 * its own shape.
 */
export interface AnalysisStore {
  save(record: AnalysisRecord): Promise<void>;
  load(id: string): Promise<AnalysisRecord | null>;
  remove(id: string): Promise<void>;
  /** Newest first. */
  list(): Promise<AnalysisSummary[]>;
}
