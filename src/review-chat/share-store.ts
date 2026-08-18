import type { StateAdapter } from "chat";

import { digest } from "@/lib/content-address";
import {
  agentContextPackageSchema,
  type ValidatedAgentContext,
} from "@/workflows/design-review-story/contract";

/**
 * The server-side registry of design-review packages that have been *explicitly* shared for
 * conversation. It holds only {@link ValidatedAgentContext} — the semantic-only agent boundary,
 * never a project document, layout, or renderer handle — so answering a question in Slack can
 * never reach a local project that was not deliberately shared. A share id that is not in the
 * store resolves to `null`, which is what lets the bot reject access rather than guess.
 */
export interface ReviewShareStore {
  /**
   * Records a package as shared and returns its id. The id is content-addressed, so sharing the
   * same package twice yields the same id and never a second entry — the share operation is
   * idempotent.
   */
  share(input: unknown): Promise<string>;
  /** Resolves a share id to its package, or `null` when nothing was shared under that id. */
  get(shareId: string): Promise<ValidatedAgentContext | null>;
}

export class InvalidReviewPackageError extends Error {
  readonly issues: readonly {
    readonly path: string;
    readonly message: string;
  }[];

  constructor(
    issues: readonly { readonly path: string; readonly message: string }[],
  ) {
    super("The review package is not a valid agent context.");
    this.name = "InvalidReviewPackageError";
    this.issues = issues;
  }
}

/** A share id is the leading 32 hex chars of the package digest, prefixed for legibility. */
export function shareIdFor(pkg: ValidatedAgentContext): string {
  return `rev_${digest(pkg).slice(0, 32)}`;
}

const KEY_PREFIX = "review-share:";

function parsePackage(input: unknown): ValidatedAgentContext {
  const parsed = agentContextPackageSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidReviewPackageError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * A {@link ReviewShareStore} backed by the same {@link StateAdapter} the Chat SDK uses for
 * subscriptions and locks. Sharing writes one durable key-value entry, so shared packages live
 * in the same store as thread state and survive a redeploy exactly as subscriptions do. No
 * separate database is introduced.
 *
 * The stored value re-parses on read: a value that predates a schema change, or was written by
 * anything other than {@link share}, is treated as absent rather than trusted.
 */
export function createStateBackedShareStore(
  state: StateAdapter,
): ReviewShareStore {
  return {
    async share(input) {
      const pkg = parsePackage(input);
      const shareId = shareIdFor(pkg);
      await state.connect();
      await state.set(`${KEY_PREFIX}${shareId}`, pkg);
      return shareId;
    },
    async get(shareId) {
      await state.connect();
      const stored = await state.get<unknown>(`${KEY_PREFIX}${shareId}`);
      if (stored === null || stored === undefined) return null;
      const parsed = agentContextPackageSchema.safeParse(stored);
      return parsed.success ? parsed.data : null;
    },
  };
}
