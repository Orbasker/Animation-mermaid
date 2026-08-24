"use client";

import { useSyncExternalStore } from "react";

import {
  detectCapabilities,
  type BrowserCapabilities,
} from "@/app/_components/diagnostics";

export interface Connectivity {
  /** Whether the browser currently reports a network connection. */
  readonly online: boolean;
  /** Whether the hosted AI copilot can be reached (network up). */
  readonly aiAvailable: boolean;
  /** The browser features the editor depends on. */
  readonly capabilities: BrowserCapabilities;
  /**
   * True when a capability the editor cannot work without is missing. Persistence (IndexedDB) is
   * treated as optional — its absence degrades to preview mode, not an unsupported browser.
   */
  readonly unsupportedBrowser: boolean;
}

function missingCriticalCapability(capabilities: BrowserCapabilities): boolean {
  return !capabilities.cryptoRandomUUID;
}

/**
 * The server render (and first client render, during hydration) assumes a healthy, online
 * browser so no recovery banner flashes in the initial HTML; the store corrects it right after
 * hydration.
 */
const SERVER_SNAPSHOT: Connectivity = {
  online: true,
  aiAvailable: true,
  capabilities: {
    indexedDB: true,
    webWorker: true,
    cryptoRandomUUID: true,
    clipboard: true,
  },
  unsupportedBrowser: false,
};

function readOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * Online status is driven by the browser's online/offline events rather than re-read from
 * `navigator.onLine`, so a subscriber sees the exact transition that fired.
 */
let onlineState = readOnline();

let snapshotCache: Connectivity | undefined;

function sameCapabilities(
  a: BrowserCapabilities,
  b: BrowserCapabilities,
): boolean {
  return (
    a.indexedDB === b.indexedDB &&
    a.webWorker === b.webWorker &&
    a.cryptoRandomUUID === b.cryptoRandomUUID &&
    a.clipboard === b.clipboard
  );
}

/**
 * Returns a stable reference while nothing has changed — required by useSyncExternalStore. It
 * re-probes capabilities each call (cheap) but only rebuilds the snapshot when online status or a
 * capability actually differs, so steady-state renders reuse the same object.
 */
function getSnapshot(): Connectivity {
  const capabilities = detectCapabilities();
  if (
    snapshotCache &&
    snapshotCache.online === onlineState &&
    sameCapabilities(snapshotCache.capabilities, capabilities)
  ) {
    return snapshotCache;
  }
  snapshotCache = {
    online: onlineState,
    aiAvailable: onlineState,
    capabilities,
    unsupportedBrowser: missingCriticalCapability(capabilities),
  };
  return snapshotCache;
}

function getServerSnapshot(): Connectivity {
  return SERVER_SNAPSHOT;
}

function subscribe(onChange: () => void): () => void {
  const goOnline = () => {
    onlineState = true;
    onChange();
  };
  const goOffline = () => {
    onlineState = false;
    onChange();
  };
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
  };
}

/**
 * Tracks the two availability axes the editor keeps separate: local editing (which needs only
 * core browser APIs) and the optional hosted AI copilot (which needs the network). It subscribes
 * to the browser's online/offline events so a dropped connection pauses AI without disturbing the
 * local session.
 */
export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
