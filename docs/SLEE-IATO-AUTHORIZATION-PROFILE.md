# SLEE as an IATO candidate execution boundary

Status: **candidate architecture / not authorized**

This document explains why the JAIN SLEE port is a promising authorization shape for ACE Omni and what still has to be true before any deployment could be considered for an IATO or ATO.

The central observation is simple:

> **SLEE makes execution authority legible.**

Omni's probabilistic or higher-order layers may propose intent, but the SLEE runtime does not need to grant those layers open-ended infrastructure authority. Accepted events drive deterministic SBB behavior; effectful work exits through an explicit Resource Adaptor contract; results return as correlated events and observations.

That is a much smaller thing to assess than an agent with ambient tool access.

## Candidate authorization boundary

```text
higher-order intent / AI / operator
                |
                v
      canonical Omni intent
                |
                v
          accepted event
                |
                v
        +----------------+
        |  OmniCallSbb   |  behavior + authoritative state
        +----------------+
                |
          OmniCommand
                |
                v
 +--------------------------------+
 | OmniTransportRaSbbInterface    |  single effect boundary
 +--------------------------------+
                |
                v
        Resource Adaptor
                |
                v
       external resource
                |
          observation/event
                |
                +--------------------> correlated SBB input
```

For the current port, the normative rule is:

> **SBB owns behavior. Resource Adaptor owns I/O.**

The SBB therefore becomes the place to reason about authoritative state transition and command intent. The RA becomes the place to reason about resource-specific privilege, protocol, network path, credentials, and external effect.

## Why this is useful for authorization

The architecture creates reviewable seams instead of relying on a claim that an autonomous system is "safe."

An assessor can ask bounded questions:

1. Which events can reach this SBB?
2. Which state transitions can each event cause?
3. Which `OmniCommand` values can be emitted?
4. Which Resource Adaptor is bound to the SBB-facing interface?
5. Which external privileges does that RA possess?
6. Which observations and failures can return?
7. Can duplicate, stale, cross-run, or terminal-state events alter authoritative state?
8. What evidence proves each answer for this exact deployed version?

Those questions can be tested and attached to an authorization package.

## Relationship to OSCAL

OSCAL and SLEE play different roles.

**SLEE is an execution model.** It defines where behavior lives, where I/O leaves the authorization boundary, how events correlate to activities, and where runtime-specific capabilities attach.

**OSCAL is an assurance and authorization representation.** The repository's OSCAL conformance layer normalizes a pinned NIST authorization-package corpus into a deterministic graph containing SSP, assessment-plan, assessment-results, POA&M, control, observation, finding, and risk objects.

The intended relationship is:

```text
OSCAL / authority sources
          |
          v
  assurance requirements
          |
          v
   assessment intent
          |
          v
 canonical Omni commands
          |
          v
   SBB behavior boundary
          |
          v
 Resource Adaptor effect
          |
          v
 observations / artifacts
          |
          v
 assessment evidence
          |
          v
 OSCAL assessment results / POA&M
```

Neither side should be allowed to impersonate the other.

- OSCAL does not grant execution authority.
- A Resource Adaptor does not decide compliance meaning.
- An LLM or operator projection does not bypass canonical commands.
- A successful conformance run is not an authorization decision.

## Machine-readable candidate profile

`conformance/authorization/slee-iato-profile.json` records the first repository-verifiable claims and the unresolved blocking gaps.

`npm run test:authorization:slee` checks that:

- the SBB still routes effects through `OmniTransportRaSbbInterface`;
- common direct network-I/O primitives have not appeared in the SBB;
- run/activity correlation remains fail-closed;
- duplicate event identities remain idempotent;
- `COMPLETED` and `FAILED` remain terminal;
- every declared claim points to repository evidence;
- the generated OSCAL graph still contains the core authorization-package artifact kinds;
- the profile remains explicitly marked `candidate-not-authorized` and retains blocking gaps.

A successful run writes:

`conformance/generated/authorization/slee-iato-profile.json`

The generated result contains a content digest and an intentionally non-authorizing decision string:

`candidate-invariants-pass-not-an-authorization`

That wording is deliberate. CI is allowed to prove architectural invariants; CI is not allowed to mint an IATO.

## What this does not yet solve

The present JAIN SLEE port is still a conformance port, not a deployable federal system boundary.

Before a real authorization package could be credible, at minimum the concrete deployment would need to define and assess:

- the actual micro-JAIN-SLEE container/runtime and its hardened configuration;
- deployable RA lifecycle and descriptors;
- every RA's network path, protocol, destination, credential, and least-privilege identity;
- authentication and operator authorization;
- secrets handling;
- audit generation, retention, review, and tamper resistance;
- evidence persistence and provenance;
- host/container/runtime hardening;
- dependency and software-supply-chain controls;
- deployment-specific SSP implementation statements;
- an assessment plan tied to the deployed boundary;
- assessment results and remediation tracking;
- POA&M handling for accepted deficiencies.

Those are not implementation trivia. They are part of the authorization story and remain blocking gaps in the candidate profile.

## The useful end state

The target is not "authorize an AI agent."

The target is closer to:

> **Authorize a bounded event-driven execution environment whose permitted external effects are exposed through enumerated Resource Adaptors, whose authoritative behavior is deterministic and replayable, and whose implementation and assessment evidence can be represented in OSCAL.**

Higher-order or probabilistic components can live above that boundary so long as they cannot manufacture capabilities or bypass the authoritative execution path.

That is the architectural bet this profile makes.
