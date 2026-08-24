/**
 * The acceptance PlantUML diagram for ANI-68: a component diagram whose `package` containers nest
 * their components, plus the dependencies between them. Importing it must reproduce a clean,
 * fully-valid model — nodes, edges, and nested groups — the strongest check that a third grammar
 * imports through the same normalized graph boundary as the Mermaid importers and feeds the
 * drill-down explorer.
 */
export const ACCEPTANCE_PLANTUML = [
  "@startuml",
  'package "Web Tier" as web {',
  "  [Browser] as browser",
  "  [CDN] as cdn",
  "}",
  'package "Application" as app {',
  '  component "API Gateway" as api',
  '  component "Orders Service" as orders',
  "}",
  'database "Postgres" as db',
  "browser --> cdn : loads",
  "browser --> api : requests",
  "api --> orders : routes",
  "orders --> db : reads/writes",
  "@enduml",
].join("\n");

/**
 * A class diagram exercising nested `namespace` containers, class bodies (whose members must be
 * skipped), and every relation kind — extension, composition, aggregation, dependency — so the
 * connector classifier is covered end to end.
 */
export const RICH_PLANTUML = [
  "@startuml",
  "' a leading comment that must be ignored",
  "namespace domain {",
  "  abstract class Shape {",
  "    +area() : double",
  "    #name : String",
  "  }",
  "  class Circle",
  "  class Square",
  "}",
  "namespace render {",
  "  class Canvas",
  "}",
  "Shape <|-- Circle",
  "Shape <|-- Square",
  "Canvas *-- Shape",
  "Canvas o-- Circle",
  "Canvas ..> Shape : draws",
  "@enduml",
].join("\n");

/**
 * A PlantUML diagram full of unsafe and unsupported constructs: a preprocessor include, a
 * script-laden quoted label, a skinparam directive, and a statement that is not a relation. Used
 * to prove that malicious input is sanitized and unsupported syntax yields actionable diagnostics
 * while the safe elements and relations still import.
 */
export const HOSTILE_PLANTUML = [
  "@startuml",
  "!include /etc/passwd",
  "skinparam backgroundColor #EEE",
  'component "<script>alert(1)</script>Login" as login',
  "component Home as home",
  "login --> home : <img src=x onerror=alert(1)>go",
  "this is not a relation",
  "@enduml",
].join("\n");
