# SCEPTRE as an Omni lower-world substrate

ACE Omni can treat Sandia's SCEPTRE ecosystem as a concrete realization layer beneath the Experiment IR without turning SCEPTRE into Omni's authority model or human-outcome model.

The useful decomposition is:

```text
Omni Regime / Experiment IR
          ↓
capability + adapter binding
          ↓
SCEPTRE world binding
          ↓
phēnix / SCORCH experiment control
          ↓
minimega environment
          ↓
Bennu / Pybennu field-device boundary
          ↓
provider / co-simulation boundary
          ↓
physical or cyber-physical process model
```

SCEPTRE is therefore best treated as a **lower-world execution substrate**: it can realize infrastructure, network, field-device, control-system, and process state while Omni retains the authoritative experiment graph, canonical commands, capability checks, evidence lineage, and assessment semantics.

## Public SCEPTRE layers

The current public Sandia repositories separate responsibilities across several cooperating components:

- **phēnix** defines, deploys, and manages cyber experiments on minimega;
- **SCORCH** provides repeatable scenario/campaign orchestration and artifact-producing pipelines;
- **minimega** supplies VM and network emulation;
- **Bennu / Pybennu** models ICS/SCADA devices and bridges field-device state to process simulations;
- **providers and HELICS** create a federation boundary around external solvers and co-simulations;
- published topologies demonstrate power, wind, waterway, virtual-only, and hardware-in-the-loop experiments.

The important architectural discovery for Omni is that the process model is not fixed to one domain. Bennu/Pybennu already supports multiple provider styles, and the newer GenericPython provider exposes a lightweight state-update seam for custom discrete-event models.

## What this PR adds

`@ace-omni/domain/sceptre-world` introduces a content-addressed binding between one exact compiled Omni experiment and one pinned SCEPTRE world definition.

A binding contains:

- the exact compiled Experiment IR SHA-256;
- the exact `T=0` baseline SHA-256;
- the already-authorized Omni adapter ID;
- pinned topology, scenario, and process-model identities + SHA-256 digests;
- the process provider class (`generic-python`, `helics`, `powerworld`, `simulink`, `opendss`, `pypower`, or `custom`);
- explicit mappings from already-authorized canonical Omni commands to a narrow SCEPTRE action vocabulary.

The action vocabulary is intentionally small:

```text
process.set
cyber.inject
network.set
observe.snapshot
```

The binding is declarative. It contains no shell command, executable, working directory, environment, argv, or script field.

## Core invariant

> SCEPTRE may realize an authorized Omni experiment, but it may not mint execution authority.

The preserved path is:

```text
higher-order intent
        ↓
canonical Omni command
        ↓
Experiment IR capability/provider resolution
        ↓
explicit adapter authorization
        ↓
SCEPTRE world binding
        ↓
runtime-specific realization
        ↓
observations / evidence
```

There is no alternate:

```text
SCEPTRE topology → arbitrary shell → effect
```

path in the domain model.

## Fail-closed rules

`compileSceptreWorldBinding()` rejects:

1. a binding for a different compiled experiment digest;
2. a binding for a different baseline seal;
3. an adapter that the Experiment IR did not authorize;
4. a SCEPTRE mapping for a canonical command not bound to that adapter;
5. an authorized adapter command that lacks an explicit SCEPTRE mapping;
6. duplicate command mappings;
7. shell/process-launch-shaped metadata such as `command`, `args`, `cwd`, `env`, `shell`, `script`, or `executable`.

Semantically equivalent mapping order and metadata key order compile to the same canonical SHA-256 binding.

## Why the baseline matters

SCEPTRE worlds can become stateful and expensive. Omni's Experiment IR already creates a logical `T=0` seal separating setup from exercise. The SCEPTRE binding pins itself to that exact seal so that a world realization cannot silently drift while evidence is still presented as though it came from the same experimental starting condition.

That boundary also composes naturally with the separate Staghorn-style state-branching work: a future runtime implementation can bind a captured SCEPTRE state artifact to the same experiment/baseline lineage before branching controlled trials.

## GenericPython as the first practical bridge

The smallest useful implementation target is not a full power-grid lab. It is a GenericPython process provider that exposes a tiny, explicit lower-world state machine.

For example:

```text
grid.available
cell_site.backhaul_available
alert_gateway.available
asl_feed.available
caption_service.latency_ms
```

A controlled experiment can change one infrastructure condition and observe the resulting state while Omni retains causality and evidence lineage.

This is especially useful for accessible-information experiments because the boundary stays clean:

```text
SCEPTRE: World
      ↓
Omni: Information
      ↓
accessibility / burden model
      ↓
Decision
      ↓
Outcome
```

SCEPTRE should not be represented as though it already models accessibility burden, cognition, trust, decision delay, or differential human outcomes. Those remain separate layers above the lower-world substrate.

## Runtime boundary

This PR intentionally does **not** implement a phēnix HTTP client, shell wrapper, SSH runner, or direct Bennu protocol client.

That is a separate runtime adapter concern. A future implementation must consume the compiled SCEPTRE binding and translate its narrow actions through a reviewed driver while continuing to emit normal Omni observations/evidence.

Keeping the runtime client out of the domain primitive prevents topology configuration from becoming an implicit execution-authority channel.

## Provenance

Architectural references:

- `sandialabs/sceptre-phenix`
- `sandialabs/sceptre-bennu`
- `sandialabs/sceptre-phenix-topologies`
- Sandia SCEPTRE / Emulytics documentation

No SCEPTRE, phēnix, Bennu, or SCORCH source code is copied by this implementation.
