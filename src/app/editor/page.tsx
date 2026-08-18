import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Editor",
  description: "Create an animation from a Mermaid diagram.",
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

      <section className="editorPlaceholder">
        <p className="eyebrow">Workspace preview</p>
        <h1>Animation editor</h1>
        <p>The editing workspace is coming next.</p>
        <div className="workspacePreview" aria-hidden="true">
          <div className="previewPanel" />
          <div className="previewCanvas">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
    </main>
  );
}
