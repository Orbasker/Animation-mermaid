import Link from "next/link";

const workflow = [
  ["01", "Paste Mermaid", "Start from a diagram you already understand."],
  ["02", "Shape the story", "Choose what appears, moves, and gets attention."],
  ["03", "Share the motion", "Export an animation that explains the flow."],
] as const;

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <nav className="nav" aria-label="Primary navigation">
          <Link className="brand" href="/">
            <span aria-hidden="true" className="brandMark">
              M
            </span>
            Animation Mermaid
          </Link>
          <Link className="navLink" href="/editor">
            Editor
          </Link>
        </nav>

        <div className="heroContent">
          <p className="eyebrow">Diagram storytelling, frame by frame</p>
          <h1>Turn Mermaid diagrams into motion</h1>
          <p className="lede">
            Build focused animations that make systems, processes, and ideas
            easier to follow—without redrawing your diagrams.
          </p>
          <div className="heroActions">
            <Link className="primaryAction" href="/editor">
              Open the editor
              <span aria-hidden="true">→</span>
            </Link>
            <a className="secondaryAction" href="#workflow">
              See how it works
            </a>
          </div>
        </div>

        <div className="diagramPreview" aria-label="Animated diagram preview">
          <div className="node nodeOne">Source</div>
          <div className="connector" aria-hidden="true">
            <span />
          </div>
          <div className="node nodeTwo">Sequence</div>
          <div className="connector" aria-hidden="true">
            <span />
          </div>
          <div className="node nodeThree">Story</div>
        </div>
      </section>

      <section
        className="workflow"
        id="workflow"
        aria-labelledby="workflow-title"
      >
        <div className="sectionHeading">
          <p className="eyebrow">A simple workflow</p>
          <h2 id="workflow-title">From syntax to story</h2>
        </div>
        <div className="workflowGrid">
          {workflow.map(([number, title, description]) => (
            <article className="workflowCard" key={number}>
              <span className="stepNumber">{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
