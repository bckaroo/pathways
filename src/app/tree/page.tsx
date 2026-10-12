import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pathways Tree — Climate Smart Communities Skill Tree",
  description:
    "Preview of the Pathways skill-tree: CSC certification actions as a prerequisite-ordered tech tree with action dossiers, funding co-benefits, and pathway tracking.",
};

export default function TreePage() {
  return (
    <main className="flex h-[calc(100vh-57px)] flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-panel/60 px-6 py-2 text-sm text-ink-muted">
        <span className="mr-auto">
          <span className="font-semibold text-ink">Pathways Tree</span> — preview
          of the skill-tree pathway explorer (CSC certification v4.5, 67
          actions). Progress is tracked in your browser only.
        </span>
        <a
          href="/pathways/tech-tree.html"
          target="_blank"
          rel="noreferrer"
          className="rounded border border-line px-3 py-1 hover:text-ok-solid"
        >
          Open full screen ↗
        </a>
        <Link href="/" className="rounded border border-line px-3 py-1 hover:text-ok-solid">
          ← Back to dashboard
        </Link>
      </div>
      <iframe
        src="/pathways/tech-tree.html"
        title="Pathways skill tree"
        className="w-full flex-1 border-0"
      />
    </main>
  );
}