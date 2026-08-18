import { defineAgent } from "eve";

import { gatewayTags } from "./lib/gateway";

/**
 * Model routes through the Vercel AI Gateway (OIDC-authenticated, no provider
 * key). The id is a Gateway catalog slug; override it with `AI_GATEWAY_MODEL`
 * to track the current catalog/configuration without a code change.
 */
const model = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-sonnet-5";

export default defineAgent({
  model,
  reasoning: "medium",
  modelOptions: {
    providerOptions: {
      gateway: {
        tags: gatewayTags(),
      },
    },
  },
});
