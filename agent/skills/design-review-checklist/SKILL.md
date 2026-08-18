---
description: Use when reviewing a UI, diagram-to-animation, or API design so the critique covers every dimension consistently.
---

# Design-review checklist

Evaluate the design against each dimension. For every issue found, produce a
finding with an `area`, a `severity` (`blocker` | `major` | `minor` | `nit`), and
a concrete `recommendation`.

## Dimensions

1. **Clarity of intent** — Is the goal of the design obvious? Does it solve the
   stated problem without scope creep?
2. **User flow** — Can a first-time user complete the primary task without
   guessing? Are entry and exit points clear?
3. **Accessibility** — Color contrast, keyboard reachability, focus order,
   motion-reduction for animations, and text alternatives for diagrams.
4. **Animation fidelity** — Does the motion clarify the diagram rather than
   distract? Is it interruptible and does it respect reduced-motion settings?
5. **Consistency** — Does it match existing patterns, naming, and components?
6. **Edge cases & errors** — Empty, loading, error, and oversized-diagram states.
7. **Feasibility** — Is it buildable on the current stack without disproportionate
   effort? Call out risky dependencies.

## Verdict

- `approve` — no blockers or majors.
- `approve_with_changes` — no blockers; majors or minors that can be fixed in
  follow-up.
- `request_changes` — one or more blockers.

Lead findings with the highest severity first.
