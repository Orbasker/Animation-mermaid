import { start } from "workflow/api";

import { storyRequestSchema } from "@/workflows/design-review-story/contract";
import { generateDesignReviewStory } from "@/workflows/design-review-story/workflow";

/**
 * Starts a run and returns its id immediately.
 *
 * The response deliberately does not stream the run to completion: the run outlives this
 * request, so the id is the durable handle. A client stores it and reads progress and results
 * from the reconnectable stream endpoints, which is what lets a reload rejoin the same run
 * rather than starting a second one.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = storyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid story request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const run = await start(generateDesignReviewStory, [parsed.data]);

  return Response.json(
    { runId: run.runId },
    { status: 202, headers: { "x-workflow-run-id": run.runId } },
  );
}
