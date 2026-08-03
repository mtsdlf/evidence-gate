# Only Objective Evidence Can Authorize a Merge

I spent two months letting coding agents merge to trunk without me. Several hundred issues went in
unattended, across seven repositories and six languages. The thing that made that survivable was not
a better model or a better prompt. It was a sixty-line function that the model is structurally
unable to influence.

Here is the whole idea:

> **Objective evidence may authorize a merge. Model judgment may only veto or escalate. It can never
> approve.**

The function is in this repository, in [`src/gate.ts`](../src/gate.ts). It is deliberately boring. The difficulty was never the implementation — it was noticing that the model must not be in
the authorizing path, and then holding that line in every place where it would have been convenient
not to.

## The tempting mistake

If you want agents merging code unattended, something has to decide when a change is good enough.
The obvious answer is to ask a model. Have a reviewer agent read the diff. Have it emit a confidence
score. Have the author agent self-assess. Gate on that.

That answer is wrong, and it is wrong in a way that stays hidden until it costs you something.

A model asked *"is this change safe to merge?"* will answer. It will answer confidently. It will
answer confidently when it is wrong. And it will answer differently next quarter, because the
weights moved underneath you and nobody told your merge queue. Every property you thought you had —
caution, calibration, willingness to say "I don't know" — is a behaviour of a particular model
generation, not a guarantee of your system. Anything downstream of that answer inherits its variance.

So the gate takes exactly one authorizing input: a boolean produced by exit codes. Build,
type-check, tests, contract compatibility — whatever the repository defines as truth, ANDed
together. Model judgment stays in the system, because it is genuinely useful there. It just enters
through a channel that can only ever *stop* a merge.

## Make the wrong thing unrepresentable

The part I care about is not the policy. It is where the policy lives.

Look at the input type and notice what is missing:

```ts
interface GateInput {
  readonly evidence: Evidence;      // { green: boolean }
  readonly vetoes: readonly Veto[]; // { gate: string; reason: string }
  readonly flakeRate?: number;
}
```

There is a `Veto`. There is no `Approval`. Approval is not representable — there is no argument shape
that would express it. No prompt injection, no jailbreak, no overconfident reviewer and no clever
tool call can produce a `merge` from this function, because the sentence "the model approved this"
cannot be written in the language the function accepts.

That is the difference between a guardrail and a convention. A convention is a thing everyone agrees
to until someone is in a hurry. This is a thing you would have to redesign the type system to break.

The same discipline has to hold everywhere the boundary could erode, and that turned out to be the
real work:

- The tool surface exposed to a meta-orchestrator has four tools, and **exactly one of them can land
  code** — through the gate. There is no raw merge tool on the wire. I have a smoke test that fails
  if one ever appears.
- The serial merge queue is the **only** path to trunk. Not the default path; the only one. Someone
  found a bypass through a REST endpoint whose URL fragment slipped my matcher. Now the matcher
  splits on `?` and `#`.
- A change that lands and then breaks trunk gets auto-reverted. But since a landed change cannot be
  un-authorized, the post-merge reviewer's veto is **translated into an advisory** rather than
  pretending it still has authority it structurally lost.

## Three rules, and the order matters more than the rules

**The flake andon comes first.** If more than 5% of the suite is nondeterministic, the gate halts and
escalates before evaluating anything else.

Most systems check flakiness *after* deciding, as a warning attached to a result. That is backwards.
Above some threshold, a green might be a flake masking a regression, and a red might be a flake
misfiring repair. Neither verdict means anything. Flakiness does not modify the decision; it
invalidates the premise the decision rests on, so it has to be evaluated before the premise is used.

**Red never merges.** It routes to repair, which may retry, escalate reasoning effort, or give up.
None of those paths reach trunk.

**Green is necessary and not sufficient.** This is where reviewers and humans get their say, and the
only thing they can do with it is stop the merge.

## Where I got this wrong

Three failures, all mine, all more instructive than the design.

**Reviewers must fail closed.** Mine failed open on HTTP 429. For two days, eight changes landed with
no model review at all. Nothing broke — which is exactly why I did not notice. A reviewer that
returns a non-committal answer, whether a refusal, a truncation or anything out of vocabulary, has to
be treated as a *loud veto*, not a soft pass. Silence is not consent, and a rate limit is silence.

Related, and I lost real money finding it: my reviewers were being truncated because extended
thinking counts against `max_tokens`. The verdict field was getting cut off mid-word. The system
read that as "no veto" and merged.

**The judge must not be the author.** If the reviewing model is the same model that wrote the change,
your soft gate is a rubber stamp with extra steps. Enforce the difference in code. And when an
operator overrides it — they will — record that the property was lost, rather than letting it vanish
silently. A guarantee that can be disabled without a trace was never a guarantee.

**A gate with credentials is not hermetic.** Mine leaked environment into the check subprocess and
produced a false red, which auto-reverted perfectly healthy code. The gate now runs in a container
with no credentials, no network egress beyond dependency caches, and read-only cache mounts. If a run
is poisoned it cannot contaminate the next one.

## What I am not claiming

The system drained several hundred issues to trunk unattended. It did **not** build those projects,
and I will not pretend otherwise — the majority of the work in those repositories is mine, done
interactively. The autonomous merges are real and they are a minority.

More importantly: this ran against my own code, with no production traffic and no external users. The
gate is real, but a bad merge cost me nothing. It has never faced a legacy codebase, an adversary, or
an incident with a customer on the other end. If you are running something like this where the blast
radius is real, my design survives the transfer and my confidence should not.

There is one component I documented as a safety control and never actually wired into any runtime
path. It is in the limitations file. I mention it here because a safety harness you have not verified
is running is a story you are telling yourself.

## The part that generalizes

Couple to the harness, not the model.

Model generations change. The behaviours you are implicitly relying on — honesty, calibrated
uncertainty, willingness to refuse — are properties of a generation, not of your architecture. Every
one of them can regress in a release you did not choose and cannot roll back.

Deterministic scaffolding does not change. Exit codes do not get more confident. A type that cannot
express approval will not learn to express it.

So put your engineering there. Not in the prompt, which is a liability you rewrite every upgrade, but
in the structure around it — the gate, the queue, the isolation boundary, the audit trail, the thing
that decides what the model is *allowed* to do rather than hoping it chooses well.

The model is a component. Treat it like one you do not trust, because in twelve months it will be a
different component wearing the same name.

