/**
 * Prepares a Web Worker global so ELK's engine (`elk-worker.min.js`) can run inside it.
 *
 * That engine decides at module-evaluation time whether it *is* a worker (`document` undefined
 * and `self` defined) — in which case it hijacks `self.onmessage` — or a normal module, in
 * which case it exports its synchronous in-process "fake worker". We want the latter: ELK
 * should run synchronously inside *this* worker so its CPU cost stays off the UI thread. A
 * dedicated worker has no `document`, so we define a minimal stub before ELK loads, steering it
 * to the export branch. Layout is pure computation and never touches the DOM, so the stub is
 * inert beyond that decision.
 *
 * This module must be imported before anything that pulls in ELK, and only ever runs in a
 * worker; on the main thread a real `document` already exists and this is a no-op.
 */
const globalScope = globalThis as { document?: unknown };

if (typeof globalScope.document === "undefined") {
  globalScope.document = {};
}

export {};
