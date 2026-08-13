import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const FIXTURES_DIR = new URL("../conformance/fixtures/", import.meta.url);
const CLOUDFLARE_DIR = new URL("../conformance/generated/cloudflare/", import.meta.url);
const SLEE_DIR = new URL("../conformance/generated/slee/", import.meta.url);
const ELIXIP_DIR = new URL("../conformance/generated/elixip/", import.meta.url);
const TERMINAL = new Set(["COMPLETED", "FAILED"]);

function runCloudflareSemanticAdapter(fixture) {
  const machine = {
    runId: null,
    activityId: null,
    state: "CREATED",
    participants: [],
    seen: new Set(),
    observations: 0,
  };
  const trace = [];

  for (const input of fixture.events) {
    const runId = input.runId ?? fixture.runId;
    const activityId = input.activityId ?? fixture.activityId;
    const commands = [];
    const observationsBefore = machine.observations;
    let accepted = false;

    if (!TERMINAL.has(machine.state)) {
      if (machine.runId === null) {
        machine.runId = runId;
        machine.activityId = activityId;
      }

      if (machine.runId === runId && machine.activityId === activityId && !machine.seen.has(input.eventId)) {
        machine.seen.add(input.eventId);
        accepted = true;

        switch (input.type) {
          case "participant_joined":
            if (!machine.participants.includes(input.participantId)) {
              if (machine.participants.length === 0) {
                machine.participants.push(input.participantId);
                machine.state = "WAITING";
              } else if (machine.participants.length === 1) {
                machine.participants.push(input.participantId);
                machine.state = "READY";
                commands.push("START_ACTIVITY");
              }
            }
            break;
          case "participant_left":
            if (machine.state === "RUNNING" && machine.participants.includes(input.participantId)) {
              machine.state = "ENDING";
            }
            break;
          case "activity_started":
            if (machine.state === "READY") machine.state = "RUNNING";
            break;
          case "observation":
            if (machine.state === "RUNNING") machine.observations += 1;
            break;
          case "activity_ended":
            if (machine.state === "RUNNING" || machine.state === "ENDING") {
              machine.state = "COMPLETED";
            }
            break;
          case "transport_failure":
            machine.state = "FAILED";
            break;
          default:
            throw new Error(`Unknown conformance event type: ${input.type}`);
        }
      }
    }

    trace.push({
      eventId: input.eventId,
      accepted,
      state: machine.state,
      commands,
      observationDelta: machine.observations - observationsBefore,
    });
  }

  return { version: 1, fixture: fixture.name, terminalState: machine.state, trace };
}

function comparable(output) {
  return { terminalState: output.terminalState, trace: output.trace };
}

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function requireRuntimeTrace(runtime, directory, name) {
  try {
    return await loadJson(new URL(name, directory));
  } catch (error) {
    throw new Error(
      `Missing ${runtime} trace for ${name}. Generate that runtime's conformance traces first.`,
      { cause: error },
    );
  }
}

await rm(CLOUDFLARE_DIR, { recursive: true, force: true });
await mkdir(CLOUDFLARE_DIR, { recursive: true });

const names = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith(".json")).sort();
if (names.length === 0) throw new Error("No Omni conformance fixtures found");

for (const name of names) {
  const fixture = await loadJson(new URL(name, FIXTURES_DIR));
  const cloudflare = runCloudflareSemanticAdapter(fixture);
  await writeFile(new URL(name, CLOUDFLARE_DIR), `${JSON.stringify(cloudflare, null, 2)}\n`);

  const slee = await requireRuntimeTrace("SLEE", SLEE_DIR, name);
  const elixip = await requireRuntimeTrace("Elixip", ELIXIP_DIR, name);
  const oracle = fixture.expected;

  if (!isDeepStrictEqual(comparable(cloudflare), oracle)) {
    throw new Error(`Cloudflare semantic trace diverged from fixture oracle: ${fixture.name}`);
  }
  if (!isDeepStrictEqual(comparable(slee), oracle)) {
    throw new Error(`SLEE semantic trace diverged from fixture oracle: ${fixture.name}`);
  }
  if (!isDeepStrictEqual(comparable(elixip), oracle)) {
    throw new Error(`Elixip semantic trace diverged from fixture oracle: ${fixture.name}`);
  }

  const cloudflareComparable = comparable(cloudflare);
  if (!isDeepStrictEqual(cloudflareComparable, comparable(slee))) {
    throw new Error(`Cloudflare/SLEE semantic divergence: ${fixture.name}`);
  }
  if (!isDeepStrictEqual(cloudflareComparable, comparable(elixip))) {
    throw new Error(`Cloudflare/Elixip semantic divergence: ${fixture.name}`);
  }

  console.log(
    `✓ ${fixture.name}: ${fixture.events.length} events, ${fixture.expected.terminalState} — Cloudflare ≡ SLEE ≡ Elixip`,
  );
}

console.log(
  `Omni Core conformance passed: ${names.length} fixtures are semantically equivalent across three runtimes.`,
);
