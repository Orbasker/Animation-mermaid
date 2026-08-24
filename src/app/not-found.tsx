import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="recoveryShell">
      <div className="recoveryState recoveryState-info" role="status">
        <div className="recoveryStateBody">
          <p className="eyebrow">404</p>
          <h1 className="recoveryStateTitle">This page doesn’t exist</h1>
          <div className="recoveryStateDescription">
            <p>
              The link may be out of date. The editor and your saved projects
              are still here.
            </p>
          </div>
        </div>
        <div className="recoveryStateActions">
          <Link className="recoveryPrimaryAction" href="/editor">
            Open the editor
          </Link>
          <Link className="recoverySecondaryAction" href="/">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
