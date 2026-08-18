import type { Metadata } from "next";
import Link from "next/link";

import { EditorWorkspace } from "@/app/editor/editor-workspace";

export const metadata: Metadata = {
  title: "Architecture workspace",
  description: "Edit and review an imported Mermaid architecture graph.",
};

export default function EditorPage() {
  return (
    <main className="editorShell">
      <nav className="nav" aria-label="Editor navigation">
        <Link className="brand" href="/">
          <span aria-hidden="true" className="brandMark">
            M
          </span>
          Animation Mermaid
        </Link>
        <Link className="navLink" href="/">
          Back home
        </Link>
      </nav>

      <section className="editorWorkspaceFrame">
        <header className="editorIntro">
          <div>
            <p className="eyebrow">Imported system map</p>
            <h1>Architecture workspace</h1>
          </div>
          <p>Shape the view. Keep the source intact.</p>
        </header>
        <EditorWorkspace />
      </section>
    </main>
  );
}
