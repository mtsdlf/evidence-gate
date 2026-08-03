import { describe, expect, it } from "vitest";
import { decide, FLAKE_ANDON_THRESHOLD } from "./gate.js";

describe("Merge-Gate Controller — authority split", () => {
  it("authorizes a merge when objective evidence is green and no soft gate vetoes", () => {
    const decision = decide({
      evidence: { green: true },
      vetoes: [],
    });

    expect(decision.action).toBe("merge");
  });

  it("routes to repair when objective evidence is red (red never authorizes)", () => {
    const decision = decide({
      evidence: { green: false },
      vetoes: [],
    });

    expect(decision.action).toBe("repair");
  });

  it("ignores forensic provenance entirely — authorization flows from the boolean only", () => {
    // Provenance is the audit trail of 'true', never an authorizer. A red
    // change carrying a glowing cited narrative must still route to repair, and a green
    // change with no provenance still merges — the boolean alone decides.
    const redWithProvenance = decide({
      evidence: {
        green: false,
        provenance: {
          narrative: "Everything looks great.",
          citations: [{ claim: "all good", citedText: "PASS", source: "ts:tests log line 1" }],
        },
      },
      vetoes: [],
    });
    expect(redWithProvenance.action).toBe("repair");

    const greenNoProvenance = decide({ evidence: { green: true }, vetoes: [] });
    expect(greenNoProvenance.action).toBe("merge");
  });

  it("escalates when a soft gate vetoes, even if objective evidence is green", () => {
    const decision = decide({
      evidence: { green: true },
      vetoes: [{ gate: "readiness", reason: "underspecified acceptance criteria" }],
    });

    expect(decision.action).toBe("escalate");
    // The reason is load-bearing: it seeds the escalation history, so a
    // single veto must surface its gate and reason, not just route to "escalate".
    expect(decision.reason).toBe("soft-gate veto: readiness (underspecified acceptance criteria)");
  });

  it("aggregates every veto's gate and reason into the escalation string (multi-veto join)", () => {
    // decide() joins ALL vetoes into the reason. Asserting only `action === "escalate"`
    // (as the single-veto case did) would not catch a regression that kept only
    // vetoes[0] or mis-joined the list — both still escalate. Pin the exact reason so
    // the format, the `; ` separator, AND the order are all part of the contract: this
    // string seeds the escalation history the human reads first.
    const vetoes = [
      { gate: "readiness", reason: "underspecified acceptance criteria" },
      { gate: "challenge", reason: "no rollback plan" },
    ];

    const decision = decide({ evidence: { green: true }, vetoes });

    expect(decision.action).toBe("escalate");
    expect(decision.reason).toBe(
      "soft-gate veto: readiness (underspecified acceptance criteria); challenge (no rollback plan)",
    );
  });
});

describe("Merge-Gate Controller — flake andon", () => {
  // The quarantine rate measures the suite's nondeterminism. When it is over the
  // threshold, no green is trustworthy — flakiness directly attacks the objective-
  // evidence foundation — so autonomous merge halts and escalates,
  // regardless of the raw verdict. The andon is the global safety valve.

  it("escalates when the flake rate is over threshold even on green with no veto", () => {
    const decision = decide({
      evidence: { green: true },
      vetoes: [],
      flakeRate: FLAKE_ANDON_THRESHOLD + 0.01,
    });

    expect(decision.action).toBe("escalate");
  });

  it("the andon takes precedence over objective-red: a red under a flaky suite is not trustworthy as a repair signal", () => {
    const decision = decide({
      evidence: { green: false },
      vetoes: [],
      flakeRate: FLAKE_ANDON_THRESHOLD + 0.01,
    });

    // Not "repair": the suite is too flaky for the red to be a real red.
    expect(decision.action).toBe("escalate");
  });

  it("does not trip at the threshold (only strictly over halts) — green still merges", () => {
    const decision = decide({
      evidence: { green: true },
      vetoes: [],
      flakeRate: FLAKE_ANDON_THRESHOLD,
    });

    expect(decision.action).toBe("merge");
  });

  it("treats an absent flake rate as zero — the andon never trips on its own", () => {
    const decision = decide({
      evidence: { green: true },
      vetoes: [],
    });

    expect(decision.action).toBe("merge");
  });

  it("carries a reason explaining the routing so escalation starts the human warm", () => {
    const decision = decide({
      evidence: { green: true },
      vetoes: [],
      flakeRate: FLAKE_ANDON_THRESHOLD + 0.5,
    });

    expect(decision.action).toBe("escalate");
    expect(decision.reason).toMatch(/flake|andon|quarantine/i);
  });
});
