---
description: Use when turning a normalized diagram (and optionally a diff between two of them) into an animated design-review narrative — a thesis, ordered beats, and scenes made of reveal/hide/highlight/annotate/camera actions.
---

# Design-review storyboard

A storyboard explains a design by *revealing it in the order a reviewer needs to
understand it*, not by playing back the diagram's drawing order. Build it in two
passes: decide what the animation argues, then time it.

## Pass 1 — the narrative

- **Thesis** — the one claim the animation makes. "Requests now fan out behind a
  single gateway", not "here is the architecture". If you cannot state a claim,
  the diagram is being described rather than reviewed.
- **Audience** — who is watching, and what they already know. This sets how much
  is revealed at once.
- **Beats** — the ordered steps that get from nothing to the thesis. Each beat
  names the entity ids it concerns. Prefer 3–7 beats; more than that is usually
  two stories.

When a comparison is supplied, the thesis is almost always about the *change*.
Lead with what the reviewer already knows (the base), then introduce what moved.

## Pass 2 — the scenes

Each scene is one beat of playback: a title, a duration, and the actions applied
together for that duration.

| Action | Use it to |
| --- | --- |
| `reveal` | Bring an entity into view for the first time |
| `hide` | Remove an entity that has served its purpose |
| `highlight` | Draw attention to something already visible |
| `annotate` | Attach a caption that explains *why* this beat matters |
| `camera` | Frame a set of entities; empty focus fits the whole diagram |

Guidelines:

- **Reveal before you reference.** Never highlight or annotate an entity that no
  earlier scene revealed.
- **Reveal edges with their endpoints**, or immediately after — a floating edge
  reads as an error.
- **One idea per scene.** If a caption needs "and", split the scene.
- **Pace for reading.** Roughly 1.5–2.5s for a reveal, 2.5–4s for a scene whose
  annotation must be read. A scene with no annotation can be shorter.
- **Open and close deliberately.** Start from the reviewer's existing mental
  model; end on a `camera` scene that frames the whole result.

## Entity ids are a closed set

Every id in every action must be one an entity in the supplied graph actually
has. There is no way to introduce a new node from a storyboard: an invented id
invalidates the entire story, and the whole proposal is rejected rather than
partially applied. When a beat seems to need something the diagram lacks, say so
in the critique instead of inventing it.

## Critique

After drafting, review the scenes against the thesis and audience you named:

- `ready` — the scenes carry the thesis; nothing a reviewer must decide first.
- `ready_with_notes` — usable, with pacing or emphasis a human should weigh.
- `needs_rework` — the scenes do not support the thesis, or the diagram cannot
  support the story that was asked for.

Notes are for the human approving the proposal. Say what you would change and
why, not that a change is merely possible.
