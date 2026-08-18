import { getReviewChatBot } from "@/review-chat";
import { InvalidReviewPackageError } from "@/review-chat/share-store";

/**
 * Explicitly shares a design-review package for conversation in Slack. The body must be a valid
 * semantic {@link import("@/workflows/design-review-story/contract").ValidatedAgentContext} — the
 * same layout-free boundary the story workflow reads — so nothing renderer-specific or
 * project-local can be shared. The returned `shareId` is what a reviewer includes when mentioning
 * the bot; a thread can only ever reach packages that passed through here.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { store } = getReviewChatBot();
  try {
    const shareId = await store.share(body);
    return Response.json({ shareId }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidReviewPackageError) {
      return Response.json(
        { error: "Invalid review package.", issues: error.issues },
        { status: 400 },
      );
    }
    throw error;
  }
}
