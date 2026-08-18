/**
 * `elk.bundled.js` reaches its in-process layout engine through a dynamic
 * `require('./elk-worker.min.js').Worker`, which Turbopack cannot resolve to a constructor in a
 * browser bundle (it rewrites the reference and layout throws `_Worker is not a constructor`).
 * We instead import the engine statically and hand ELK an explicit `workerFactory`. The shipped
 * `elk-worker.min.js` has no matching declaration file, so this ambient module types the fake
 * worker it exports — a synchronous, in-process stand-in with a `Worker`-shaped `postMessage`.
 */
declare module "elkjs/lib/elk-worker.min.js" {
  interface ElkFakeWorker {
    postMessage(message: unknown): void;
    terminate?(): void;
  }
  interface ElkFakeWorkerConstructor {
    new (url?: string): ElkFakeWorker;
  }
  export const Worker: ElkFakeWorkerConstructor;
  const _default: ElkFakeWorkerConstructor;
  export default _default;
}

declare module "elkjs/lib/elk-api.js" {
  import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api";

  export interface ELKConstructorArguments {
    defaultLayoutOptions?: LayoutOptions;
    algorithms?: string[];
    workerFactory?: (url?: string) => { postMessage(message: unknown): void };
    workerUrl?: string;
  }

  export default class ELK {
    constructor(args?: ELKConstructorArguments);
    layout(
      graph: ElkNode,
      options?: { layoutOptions?: LayoutOptions; signal?: AbortSignal },
    ): Promise<ElkNode>;
  }

  export type { ElkNode, LayoutOptions };
}
