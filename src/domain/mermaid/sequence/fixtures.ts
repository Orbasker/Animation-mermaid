/**
 * The acceptance sequence diagram for ANI-22: a client placing an order through an API, a
 * service, and a database. Importing it must reproduce a clean, fully-valid model — four
 * participants and the ordered messages between them — the strongest check that the second
 * grammar imports through the same normalized graph boundary as the flowchart importer.
 */
export const ACCEPTANCE_SEQUENCE = [
  "sequenceDiagram",
  "  participant client as Client",
  "  participant api as API Gateway",
  "  participant service as Orders Service",
  "  participant db as Database",
  "  client->>api: Place order",
  "  api->>service: Create order",
  "  service->>db: Persist order",
  "  db-->>service: Ack",
  "  service-->>api: Created",
  "  api-->>client: 201",
].join("\n");

/**
 * A sequence diagram exercising the supported surface plus reported-but-ignored constructs:
 * an actor, an implicit participant, async and lost messages, an activation marker, a note,
 * and a control block whose inner messages must still import.
 */
export const RICH_SEQUENCE = [
  "sequenceDiagram",
  "  %% a comment that must be ignored",
  "  actor user as User",
  "  participant web as Web App",
  "  autonumber",
  "  user->>web: Open",
  "  web->>worker: Enqueue job",
  "  activate worker",
  "  loop every minute",
  "    worker-)web: Progress",
  "  end",
  "  worker--xweb: Failed once",
  "  Note over user,web: retried automatically",
  "  worker-->>web: Done",
  "  deactivate worker",
].join("\n");

/**
 * A sequence diagram full of unsafe and unsupported constructs: an init directive, a
 * script-laden participant alias and message label, and a statement that is not a message.
 * Used to prove that malicious input is sanitized and unsupported syntax yields actionable
 * diagnostics — while the safe messages still import.
 */
export const HOSTILE_SEQUENCE = [
  "%%{init: {'theme':'dark'}}%%",
  "sequenceDiagram",
  '  participant a as "<script>alert(1)</script>Login"',
  "  participant b as Home",
  "  a->>b: <img src=x onerror=alert(1)>go",
  "  this is not a message",
].join("\n");
