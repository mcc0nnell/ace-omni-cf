# ACE Omni lineage

ACE Omni has now crossed enough runtime boundaries that its architectural lineage can be studied independently of any one implementation.

## Generation 1 — original ACE Omni

Repository: `mitrefccace/ace-omni`

The original implementation expresses a research platform through:

- Mongo-backed experiments and calls;
- module/configuration trees for participant UI, audio, ASR/caption and corruption/filter conditions;
- Caller, Callee, and optional CA roles;
- Socket.IO room/call/signaling orchestration;
- cloud ASR integrations;
- transcripts and audio/screen/video/other-data collection;
- call cleanup/finalization.

The important architectural fact is not Node.js or MongoDB. It is that an experiment definition is selected, instantiated as a correlated communications activity, manipulated, observed, and preserved as research data.

## Generation 2 — Cloudflare resurrection

Repository: `mcc0nnell/ace-omni-cf`

The resurrection preserves that experiment purpose but moves authority and provenance into explicit primitives:

- immutable experiment versions;
- per-call Durable Object authority;
- authenticated participant identity and role;
- deterministic signed schedules;
- generic experiment runs and system-under-test adapters;
- versioned observation envelopes;
- replay-safe event identity;
- D1/R2 evidence storage;
- immutable final manifests.

This generation separates **what was intended** from **what an endpoint reported actually occurring**.

## Generation 3 — SLEE conformance port

Directory: `ports/jain-slee/`

The first SLEE slice asks a different question: what remains when Cloudflare itself is removed?

The mapping is:

- stateful experiment behavior -> SBB;
- external execution resource -> Resource Adaptor;
- runtime occurrence -> SLEE event;
- execution correlation -> Activity Context plus explicit Omni identity;
- experiment configuration -> profile/configuration input;
- timeout/schedule delivery -> Timer Facility;
- evidence persistence -> external RA, not SBB business state.

The first vertical slice compiles against the standard JAIN SLEE 1.1 API so the experiment behavior is not tied to a particular historical SLEE container. A modern micro-JAIN-SLEE binding can replace only the thin container integration layer.

## What survived

Across all three generations, the candidate invariant grammar is:

```text
experiment definition
        -> immutable/identified execution
        -> participants and activities
        -> intended commands/conditions
        -> external resource execution
        -> observations
        -> correlated state transitions
        -> evidence
        -> terminal outcome
```

That surviving grammar is what `docs/omni-core/SPEC.md` calls **Omni Core**.

## What did not survive

These are implementation choices, not core semantics:

- MongoDB;
- D1;
- R2;
- EC2;
- Workers;
- Durable Objects;
- Socket.IO;
- browser WebSocket framing;
- filesystem layout;
- a particular ASR provider;
- a particular SLEE container.

## Next lineage experiment

The next useful experiment is not another rewrite. It is a conformance comparison: feed equivalent canonical events to the Cloudflare and SLEE implementations and compare semantic traces for state, command intent/order, correlation, observation acceptance, and terminal outcome.

After that boundary is proven, SIP/Elixip can enter as a Resource Adaptor without becoming the experiment model itself.
