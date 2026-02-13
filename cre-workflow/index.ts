import { metadata, run } from "../cre/workflow";

/**
 * Backward-compatible entrypoint.
 * The canonical V1.5 workflow implementation lives in `cre/workflow.ts`.
 */
export const workflowMetadata = metadata;
export const runKobaGovernanceWorkflow = run;
