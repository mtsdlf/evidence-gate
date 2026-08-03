/**
 * The merge gate.
 *
 * One invariant, enforced structurally rather than by convention:
 *
 *   Objective evidence may AUTHORIZE a merge.
 *   Model judgment may only VETO or ESCALATE. It can never authorize.
 *
 * The decision is a pure function whose only authorizing input is a boolean
 * produced by exit codes. There is no prompt, no tool call and no reviewer
 * verdict that can talk this function into returning "merge". That is the
 * point: an agent harness where the model's self-assessment can reach the
 * merge decision has no merge gate, only a suggestion.
 */

/**
 * Objective, machine-produced evidence about a change — the only authorizer.
 *
 * `green` is the AND of whatever checks the repository defines as truth: build,
 * type-check, tests, contract compatibility, coverage thresholds. It must come
 * from exit codes or machine-readable output, never from prose. A model
 * asserting "the tests pass" is not evidence; the test runner's exit code is.
 */
export interface Evidence {
  readonly green: boolean;
  /**
   * Fraction of the suite detected as nondeterministic at collection time.
   * Optional; absent reads as 0 (deterministic suite).
   */
  readonly flakeRate?: number;
  /**
   * A cited narrative over the raw check output — the audit trail of *why* the
   * boolean is what it is, and the warm-start material for whoever picks up an
   * escalation.
   *
   * **Deliberately non-authorizing. `decide` never reads this field.** It is
   * declared here so the model has somewhere to put its reasoning that is
   * visibly outside the decision path. A red change carrying a glowing
   * narrative still routes to repair; there is a test for exactly that.
   */
  readonly provenance?: EvidenceProvenance;
}

/** Model-written explanation of the evidence. Read by humans, never by the gate. */
export interface EvidenceProvenance {
  readonly narrative: string;
  readonly citations: readonly EvidenceCitation[];
}

/** A claim tied back to the raw artifact that supports it. */
export interface EvidenceCitation {
  readonly claim: string;
  /** Verbatim text from the artifact. */
  readonly citedText: string;
  /** Where it came from — a log line, a file, a check name. */
  readonly source: string;
}

/**
 * A soft-gate veto — a reviewer, a policy check, a human. Soft gates exist to
 * stop things, never to start them. Note there is deliberately no "approve"
 * counterpart to this type: approval is not representable in the input.
 */
export interface Veto {
  readonly gate: string;
  readonly reason: string;
}

/**
 * Quarantine-rate ceiling for the flake andon.
 *
 * Above this, autonomous merge halts. The reasoning is that a sufficiently
 * nondeterministic suite compromises the evidence foundation itself: a green
 * may be a flake masking a regression, and a red may be a flake misfiring
 * repair. Neither verdict can be trusted, so neither may route.
 *
 * A policy default. The threshold is meant to be tuned; the mechanism is not.
 */
export const FLAKE_ANDON_THRESHOLD = 0.05;

export type GateAction = "merge" | "repair" | "escalate";

export interface GateInput {
  readonly evidence: Evidence;
  readonly vetoes: readonly Veto[];
  /** Suite flake rate. Over `FLAKE_ANDON_THRESHOLD` the andon trips. */
  readonly flakeRate?: number;
}

export interface GateDecision {
  readonly action: GateAction;
  /** Why the gate routed this way. Carried into the escalation record. */
  readonly reason: string;
}

export function decide(input: GateInput): GateDecision {
  const flakeRate = input.flakeRate ?? 0;

  // The andon precedes every other branch because it invalidates the premise
  // the other branches rest on. If the suite is too flaky, neither the green
  // nor the red below means anything. Halt and put a human on it.
  if (flakeRate > FLAKE_ANDON_THRESHOLD) {
    return {
      action: "escalate",
      reason: `flake andon: quarantine rate ${flakeRate} over ${FLAKE_ANDON_THRESHOLD} — no green is trustworthy`,
    };
  }

  // Red never merges. It routes to repair — which may retry, escalate effort,
  // or give up, but cannot reach trunk.
  if (!input.evidence.green) {
    return { action: "repair", reason: "objective evidence red — route to repair" };
  }

  // Green is necessary but not sufficient. This is where model judgment enters,
  // and the only thing it is allowed to do here is stop the merge.
  if (input.vetoes.length > 0) {
    return {
      action: "escalate",
      reason: `soft-gate veto: ${input.vetoes.map((v) => `${v.gate} (${v.reason})`).join("; ")}`,
    };
  }

  return { action: "merge", reason: "objective evidence green, no soft-gate veto" };
}
