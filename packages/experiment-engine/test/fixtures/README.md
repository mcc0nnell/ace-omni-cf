# Experiment-engine interoperability fixtures

## `baudot-interop004.observation-inputs.jsonl`

This fixture is copied byte-for-byte from the green Baudot `BAUDOT-INTEROP-004` bridge evidence bundle and exists to prove that ACE Omni can ingest the actual candidate format produced by Baudot rather than a hand-written approximation.

Source provenance:

- repository: `mcc0nnell/baudot`
- pull request: `#45` — `Bridge live INTEROP-004 evidence into ACE Omni observation inputs`
- source head: `f4dfe0c21e530d02d4fb5b4547fbf0098716a16b`
- GitHub Actions run: `33996472033`
- artifact: `baudot-evidence` (`9978215143`)
- artifact digest: `sha256:61cf2136f84c00892f94ce7fa5563dd1fe29dc24e7c652d4f9ea5f92ddb66a46`
- source path inside artifact: `BAUDOT-INTEROP-004/omni-bridge-v1/observation-inputs.jsonl`
- fixture SHA-256: `f15a1a84044bb210f879f3ebeb472bed83444f7211c957d429eb96e1f914220f`
- observation count: `17`
- source run binding: `baudot-ci-33996472033-1`
- source adapter binding: `baudot-interop004`

The source bundle labels these records `candidate-input`. ACE Omni therefore treats the source `runId` and `adapterId` as provenance when the fixture is imported into an Omni-owned experiment run. Omni creates the authoritative target `ObservationEnvelope` identity and payload digest; it does not rewrite the Baudot payload or collapse source identities.

This fixture does **not** claim that the source CI run was a live ACE Omni Durable Object room. The live TRS room path continues to bind `runId` to the server call ID and persists authoritative room sequence to D1.
