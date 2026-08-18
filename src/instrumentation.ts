import type { Instrumentation } from "next";

import { createServerErrorEvent } from "@/observability/events";
import { recordObservabilityEvent } from "@/observability/server";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  recordObservabilityEvent(createServerErrorEvent(error, context));
};
