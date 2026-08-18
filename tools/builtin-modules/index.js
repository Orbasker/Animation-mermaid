/**
 * The Node.js builtin module names, as a static ESM export.
 *
 * The Workflow DevKit bundles `@workflow/builders` — which reads this list to build a regex
 * that spots Node builtin imports — into two very different targets: `steps.mjs`, loaded as
 * a real ES module by Node, and `workflows.mjs`, evaluated inside the workflow VM sandbox.
 * Neither upstream shape survives both: `builtin-modules@>=4` imports a JSON module and
 * esbuild emits that import without the required `with { type: "json" }` attribute, so Node
 * rejects `steps.mjs`; `builtin-modules@3` calls `require("module")`, which is undefined in
 * the sandbox, so the workflow bundle throws. A static array has neither dependency.
 *
 * Names are unprefixed (no `node:`) and contain no subpaths, matching the upstream shape.
 */
const builtinModules = [
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "perf_hooks", "process",
  "punycode", "querystring", "readline", "repl", "sea", "sqlite",
  "stream", "string_decoder", "test", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi",
  "worker_threads", "zlib",
];

export default builtinModules;
