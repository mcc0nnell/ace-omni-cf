# Original ACE Omni — behavioral archaeology

Source: `mitrefccace/ace-omni`

This note records behavior relevant to the runtime-independent Omni Core. It is not a source-code port.

## Experiment model

The original `models/Experiment.js` defines experiments as named studies with a phase, alias, description/purpose and one or more modules.

Modules contain configurations. Configurations contain participants and participant-specific communications conditions including:

- incoming audio presentation;
- background-noise injection;
- simulated packet drops and repetition intervals;
- audio filters and gain/pitch/quality controls;
- ASR engine selection;
- caption finalization, punctuation, error/dropout simulation and delay;
- caption display/format/appearance;
- data-collection policy for transcripts, audio, screen/video recordings and other ASR data.

This is the earliest clear form of **ExperimentDefinition**: a controlled communications world is described before a call executes.

## Call model

The original `models/Call.js` records:

- study ID;
- selected module and configuration snapshots;
- call name/directory;
- start/end/duration;
- participants;
- transcripts;
- audio recordings;
- screen recordings;
- video recordings;
- other data.

Participant roles are explicitly `Caller`, `Callee`, and `Ca`.

`routes/call.js` creates a call from a selected study/module/configuration and snapshots the participant roles into the call record. The first configured participant is Caller, the second Callee, and an optional third participant is CA.

This is the earliest clear form of **ExperimentRun/Activity + EvidenceRecord** even though those terms were not yet explicit.

## Runtime/event behavior

The original `socket.js` mixes runtime behavior and transport I/O in one Socket.IO layer.

Relevant message flow includes:

```text
joinRoom
  -> participantHasJoined

initiateCall
  -> incomingCall

acceptCall
  -> callAccepted

sendOffer / sendAnswer / iceCandidate
  -> peer signaling

initStudyCallee
  -> select study/module/configuration
  -> create or recover Call
  -> prepare data collection
  -> emit callData

startCaptions
  -> start selected ASR resource
  -> emit caption-data
  -> optionally persist transcript

sendEndCall / leaveRoom / disconnect
  -> peer end notification
  -> call cleanup/final timing/file sizes
```

The important finding is that **orchestration and I/O are coupled**. The SLEE port intentionally decomposes this into SBB behavior and Resource Adaptor I/O.

## Stable semantics extracted

The original implementation demonstrates that ACE Omni requires at least:

1. experiment configuration;
2. participant roles;
3. a correlated execution/call;
4. controlled communications conditions;
5. external communications/media/ASR resources;
6. observations and collected artifacts;
7. an identifiable end of execution;
8. retained research data linked to that execution.

## Implementation-specific details not promoted to Omni Core

- Mongo/Mongoose schemas;
- EC2/Amazon Linux hosting;
- Socket.IO message framing;
- filesystem directory naming;
- direct filesystem writes;
- specific cloud-provider credential files;
- NGINX path rewriting;
- the assumption that transport orchestration and experiment logic live in the same server file.

The Cloudflare resurrection and SLEE conformance port are used to determine which remaining concepts survive another runtime change.
