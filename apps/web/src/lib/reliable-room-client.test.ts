import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReliableRoomClient, type ReliableRoomClientOptions } from "./reliable-room-client";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class FakeSocket {
  readyState = CONNECTING;
  readonly sent: string[] = [];
  readonly protocols: string[];
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  constructor(readonly url: string, protocols: string[]) {
    this.protocols = protocols;
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    if (this.readyState !== OPEN) throw new Error("socket is not open");
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.emit("close", { code, reason });
  }

  open() {
    this.readyState = OPEN;
    this.emit("open", {});
  }

  receive(message: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify(message) });
  }

  fail() {
    this.emit("error", {});
    this.emit("close", { code: 1006, reason: "network" });
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function settle() {
  return Promise.resolve().then(() => Promise.resolve());
}

describe("ReliableRoomClient", () => {
  const storage = new MemoryStorage();
  const sockets: FakeSocket[] = [];
  const credentials: string[] = [];
  const messages: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    storage.clear();
    sockets.length = 0;
    credentials.length = 0;
    messages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createClient(overrides: Partial<ReliableRoomClientOptions> = {}) {
    return new ReliableRoomClient({
      url: "wss://omni.test/api/calls/call/ws",
      storageKey: "room-outbox:test",
      storage,
      random: () => 0.5,
      retryBaseMs: 100,
      issueCredential: async () => {
        const credential = `credential-${credentials.length + 1}`;
        credentials.push(credential);
        return credential;
      },
      socketFactory: (url, protocols) => {
        const socket = new FakeSocket(url, protocols);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onMessage: (message) => messages.push(message),
      ...overrides,
    });
  }

  it("reconnects with a fresh one-use credential and replays an unacknowledged event", async () => {
    const client = createClient();
    client.start();
    await settle();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", lastSequence: 1, state: "active" });
    client.sendDurable({
      type: "manipulation_executed",
      manipulationId: "caption-delay",
      clientClockMs: 100,
    }, "execute:caption-delay");
    const firstDelivery = JSON.parse(sockets[0]!.sent[0]!);

    sockets[0]!.fail();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    sockets[1]!.open();
    sockets[1]!.receive({ type: "welcome", lastSequence: 2, state: "active" });
    const replay = JSON.parse(sockets[1]!.sent[0]!);

    expect(credentials).toEqual(["credential-1", "credential-2"]);
    expect(sockets[1]!.protocols).toEqual(["ace-omni.v1", "credential.credential-2"]);
    expect(replay).toEqual(firstDelivery);

    sockets[1]!.receive({
      type: "event_ack",
      clientEventId: "execute:caption-delay",
      sequence: 14,
      applied: false,
    });
    expect(client.pendingEventCount()).toBe(0);
    expect(client.authoritativeSequence()).toBe(14);
  });

  it("restores a tab-killed outbox and preserves the client event id", async () => {
    const first = createClient();
    first.start();
    await settle();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", lastSequence: 1, state: "active" });
    first.sendDurable({
      type: "caption_displayed",
      utteranceId: "utterance-1",
      text: "Synthetic caption",
      isFinal: true,
      clientClockMs: 200,
    }, "caption:utterance-1:displayed");
    first.stop();

    const restored = createClient();
    restored.start();
    await settle();
    sockets[1]!.open();
    sockets[1]!.receive({ type: "welcome", lastSequence: 2, state: "active" });

    expect(restored.pendingEventCount()).toBe(1);
    expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({
      clientEventId: "caption:utterance-1:displayed",
      type: "caption_displayed",
    });
  });

  it("persists generic observation events until an authoritative ACK", async () => {
    const client = createClient();
    client.start();
    await settle();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", lastSequence: 4, state: "active" });
    client.sendDurable({
      type: "observation",
      observationId: "sample:1",
      adapterId: "browser-webrtc",
      sourceId: "pc-a",
      observedAt: "2026-08-12T23:25:00.000Z",
      payload: { version: 1, sequence: 1 },
      clientClockMs: 1_786_579_500_000,
    }, "observation:pc-a:1");

    expect(client.pendingEventCount()).toBe(1);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({
      type: "observation",
      clientEventId: "observation:pc-a:1",
      observationId: "sample:1",
      adapterId: "browser-webrtc",
      sourceId: "pc-a",
    });

    sockets[0]!.receive({
      type: "event_ack",
      clientEventId: "observation:pc-a:1",
      sequence: 5,
      applied: true,
    });
    expect(client.pendingEventCount()).toBe(0);
    expect(client.authoritativeSequence()).toBe(5);
  });

  it("uses one reconnect timer when error and close both fire", async () => {
    const client = createClient();
    client.start();
    await settle();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", lastSequence: 1, state: "active" });
    sockets[0]!.fail();

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(credentials).toHaveLength(2);
    expect(sockets).toHaveLength(2);
  });

  it("sends each pending event once per connection", async () => {
    const client = createClient();
    client.start();
    await settle();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", lastSequence: 1, state: "active" });
    client.sendDurable(
      { type: "recording_started", artifactType: "microphone_audio", clientClockMs: 10 },
      "recording:microphone_audio:started",
    );
    client.sendDurable(
      { type: "recording_started", artifactType: "local_video", clientClockMs: 11 },
      "recording:local_video:started",
    );

    expect(sockets[0]!.sent.map((value) => JSON.parse(value).clientEventId)).toEqual([
      "recording:microphone_audio:started",
      "recording:local_video:started",
    ]);
  });

  it("rejects stale snapshots without regressing the authoritative sequence", async () => {
    const client = createClient();
    client.start();
    await settle();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", lastSequence: 12, state: "active" });
    sockets[0]!.receive({ type: "welcome", lastSequence: 9, state: "waiting" });
    sockets[0]!.receive({ type: "schedule_issued", sequence: 13, schedule: {} });
    sockets[0]!.receive({ type: "participant_left", sequence: 11 });

    expect(client.authoritativeSequence()).toBe(13);
    expect(messages.map((message) => [message.type, message.lastSequence ?? message.sequence])).toEqual([
      ["welcome", 12],
      ["schedule_issued", 13],
    ]);
  });
});
