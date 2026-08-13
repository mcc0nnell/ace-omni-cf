# Omni Core — semantic kernel draft

Status: **experimental / extracted from implementation lineage**

This document defines the smallest runtime-independent vocabulary currently visible across the original MITRE ACE Omni implementation and the Cloudflare resurrection. The JAIN SLEE port is the first conformance experiment against this vocabulary.

## Provenance

Behavioral sources:

- `mitrefccace/ace-omni` — original ACE Omni implementation.
- this repository — Cloudflare-native ACE Omni resurrection and subsequent Emulytics/evidence work.

The original implementation remains subject to its repository notice. This specification describes architecture and externally meaningful behavior; the SLEE implementation is new code.

## What survived the runtime change

The original system already contains the core experiment shape:

- an **Experiment** defines modules, configurations, participants, media/caption conditions, and data-collection policy;
- a **Call** records the selected study/module/configuration, participant roles, timing, transcripts, audio, screen/video recordings, and other collected data;
- runtime messages join participants, initiate/accept calls, exchange signaling, initialize the selected study configuration, start captions, collect media, and close/finalize the call.

The Cloudflare resurrection makes several formerly implicit properties explicit:

- immutable experiment versions;
- authoritative run/call identity;
- deterministic command/schedule ordering;
- capability-scoped system-under-test adapters;
- observations distinct from commands;
- idempotent delivery/replay identity;
- ordered evidence and immutable finalization.

The candidate Omni Core is therefore not a particular database, websocket protocol, cloud platform, or media stack.

## Core entities

### ExperimentDefinition

Research intent and configurable conditions independent of a particular execution.

### ExperimentVersion

An immutable version of an experiment definition. A run must identify exactly one version.

### ExperimentRun

One execution of an experiment version.

Required identity:

- `runId`
- `experimentId`
- `experimentVersionId`
- deterministic seed or equivalent execution input when conditions require randomness

### Participant

A human or system role participating in the run. Role assignment is authoritative experiment state, not client self-assertion.

The original Omni vocabulary includes Caller, Callee, and CA roles.

### Activity

A correlated unit of execution inside a run. A telecommunications call is one kind of activity, not the definition of the abstraction.

Required identity:

- `activityId`
- parent `runId`

### Command

An authoritative instruction describing an intended change in an attached runtime.

A command is **not evidence that the change occurred**.

At minimum a command carries:

- command identity;
- run/activity identity;
- authoritative sequence;
- target resource/adapter;
- operation and parameters;
- deterministic inputs where required.

### Observation

A report from an execution endpoint or measurement source describing something it observed.

An observation is **not automatically authoritative truth**. It becomes part of the research record only after the experiment runtime binds it to authoritative run/activity/source identity and evidence ordering.

At minimum an observation carries:

- observation identity;
- run/activity identity;
- source identity;
- observation time/source time where available;
- structured payload;
- payload digest.

### Transition

A deterministic state change caused by an accepted event.

### Evidence

Structured provenance connecting intended conditions, commands, observations, transitions, artifacts, and terminal outcome.

Evidence is not a console log.

## Minimal lifecycle

The first conformance lifecycle is:

```text
CREATED
  -> WAITING_FOR_PARTICIPANTS
  -> READY
  -> RUNNING
  -> ENDING
  -> COMPLETED

failure from any nonterminal state:
  -> FAILED
```

`COMPLETED` and `FAILED` are terminal. Later events may be recorded as diagnostics by a runtime, but they cannot reopen experiment state.

This lifecycle is intentionally smaller than the complete product lifecycle. Additional states require evidence that they represent stable Omni semantics rather than implementation detail.

## Event semantics

The first shared event vocabulary is:

- `PARTICIPANT_JOINED`
- `PARTICIPANT_LEFT`
- `ACTIVITY_STARTED`
- `OBSERVATION_RECEIVED`
- `ACTIVITY_ENDED`
- `TRANSPORT_FAILURE`

A conforming runtime must reject or ignore an event whose `runId` or `activityId` does not match the state machine it is attempting to mutate.

An accepted event identity must be idempotent: retrying the same event must not create a second command or second transition.

## Authority rules

Attached execution endpoints may:

- execute authorized commands;
- report observations;
- report failures;
- expose resource state through an adapter.

They may not independently choose authoritative:

- experiment identity;
- experiment version;
- run identity;
- participant role;
- command sequence;
- evidence sequence;
- final evidence identity.

This rule is preserved from the server-authoritative Cloudflare implementation and is a normative Omni Core invariant.

## SBB / Resource Adaptor interpretation

In the SLEE conformance port:

- **SBB** implements deterministic experiment/activity behavior and state transitions;
- **Resource Adaptor** owns external I/O and turns commands into resource operations;
- **resource events** become Omni observations/events;
- **Activity Context** supplies event correlation in addition to explicit Omni run/activity identity;
- **Profiles/configuration** are candidates for experiment configuration binding;
- **Timer Facility** is the natural runtime mechanism for deterministic timeout/schedule delivery.

The RA must never contain experiment policy that decides what the run means. The SBB must never open the resource connection itself.

## Conformance properties

A runtime conforms to this draft slice when the same canonical input sequence produces semantically equivalent results:

1. participant A joins;
2. participant B joins;
3. exactly one `START_ACTIVITY` command is emitted;
4. the activity-start event transitions to `RUNNING`;
5. observations correlate only to that run/activity;
6. activity end transitions to `COMPLETED`;
7. duplicate delivery is idempotent;
8. cross-run/cross-activity events do not contaminate state;
9. terminal state cannot reopen;
10. transport failure reaches terminal `FAILED`.

Semantic equivalence is about state, command intent/order, correlation, and terminal outcome. It does not require byte-for-byte equality of runtime-specific logs, database writes, WebSocket frames, or container metadata.

## Working hypothesis

> ACE Omni is a portable execution grammar for controlled communications experiments. Node/Mongo, Cloudflare, and SLEE are implementations of that grammar rather than the grammar itself.
