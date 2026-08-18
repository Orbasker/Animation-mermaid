import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";

import { FEATURE, resolveEnvironment } from "./lib/gateway";

/**
 * eve already injects `eve.session.id`, `eve.environment`, and the turn/step
 * context onto every span. We add `feature` and `env` so a run is identifiable
 * by the same dimensions used for Gateway usage tags. Model input/output
 * content is left unrecorded (the default) for privacy.
 */
export default defineInstrumentation({
  setup: ({ agentName }) => registerOTel({ serviceName: agentName }),
  events: {
    "step.started"() {
      return {
        runtimeContext: {
          feature: FEATURE,
          env: resolveEnvironment(),
        },
      };
    },
  },
});
