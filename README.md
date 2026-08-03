# evidence-gate

**Objective evidence may authorize a merge. Model judgment may only veto or escalate. It can never approve.**

That is the whole idea. This repository is the sixty-line function that makes it structural instead
of aspirational, plus the tests that pin it down.

```ts
decide({ evidence: { green: true },  vetoes: [] })                    // → merge
decide({ evidence: { green: false }, vetoes: [] })                    // → repair
decide({ evidence: { green: true },  vetoes: [securityReviewVeto] })  // → escalate
decide({ evidence: { green: true },  vetoes: [], flakeRate: 0.08 })   // → escalate
```

## Why this exists

If you let coding agents merge to trunk unattended, something has to decide when a change is good
enough. The tempting answer is to ask a model — a reviewer agent, a confidence score, a
self-assessment. That answer is wrong, and it is wrong in a way that is hard to see until it costs
you something.

A model asked "is this change safe to merge?" will answer. It will answer confidently. It will
answer confidently when it is wrong, and it will answer differently on Tuesday than it did on Monday
because the weights changed under you. Anything downstream of that answer inherits its variance.

So the gate takes exactly one authorizing input: **a boolean produced by exit codes.** Build,
type-check, tests, contract compatibility — whatever the repository defines as truth, ANDed
together. Model judgment is still in the system, and it is genuinely useful there, but it enters
through a channel that can only ever *stop* a merge.

Look at the input type and notice what is missing: there is a `Veto`, and there is no `Approval`.
Approval is not representable. You cannot pass one in. No prompt injection, no jailbreak, no
overconfident reviewer and no clever tool call can produce a `merge` from this function, because
there is no argument shape that would express it.

**That is the difference between a guardrail and a convention.** A convention is a thing everyone
agrees to until someone is in a hurry.

## The three rules, in precedence order

**1. The flake andon comes first.** If more than 5% of the suite is nondeterministic, the gate halts
and escalates before looking at anything else — because at that point a green might be a flake
masking a regression, and a red might be a flake misfiring repair. Neither verdict means anything,
so neither is allowed to route. Most systems check flakiness *after* deciding, as a warning. It
belongs before, as a precondition: it invalidates the premise the other rules rest on.

**2. Red never merges.** It routes to repair, which may retry, escalate effort, or give up — but
cannot reach trunk by any path.

**3. Green is necessary and not sufficient.** This is where reviewers, policy checks and humans get
their say, and the only thing they can do with it is stop the merge.

## What this is not

It is not a merge queue, a CI runner, or an agent framework. It is the decision function those
things should be built around, extracted from a larger system so the idea can be read in two minutes
instead of inferred from an architecture.

It is also not novel in the sense of being clever. It is deliberately boring — sixty lines, no
dependencies, no I/O, one branch per rule. The difficulty was never the implementation. It was
noticing that the model must not be in the authorizing path, and then holding that line everywhere
it would have been convenient not to.

## Where it came from

Extracted from a personal autonomous delivery system that drained several hundred issues to trunk
unattended across seven repositories and six languages. The rest of that system is much larger and
much less interesting than this file.

Some hard-won details that did not survive the extraction, in case you are building the same thing
and want to skip the tuition:

- **Reviewers must fail closed.** A reviewer that returns a non-committal verdict — a refusal, a
  truncated response, anything out of vocabulary — has to be treated as a loud veto, not a soft
  pass. Mine failed open on HTTP 429 for two days and eight changes landed with no review at all.
  Nothing broke, which is exactly why I did not notice.
- **The judge must not be the author.** If the reviewing model is the same model that wrote the
  change, the soft gate is a rubber stamp with extra steps. Enforce the difference in code, and if
  an operator overrides it, record that the property was lost rather than letting it vanish.
- **A gate with credentials is not hermetic.** Mine leaked environment into the check subprocess and
  produced a false red that auto-reverted healthy code. Run it with nothing.

## Tests

```
npm install && npm test
```

Ten cases, covering each branch and the precedence between them — including the one that matters
most: green evidence plus a veto does not merge, and a flaky suite does not merge even when
everything else is green.

## License

MIT.
