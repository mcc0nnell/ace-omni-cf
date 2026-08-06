export const DURABLE_ROOM_EVENT_TYPES = [
  "manipulation_ack",
  "manipulation_executed",
  "caption_displayed",
  "recording_started",
  "recording_stopped",
] as const;

export type DurableRoomEventType = (typeof DURABLE_ROOM_EVENT_TYPES)[number];

export type RoomConnectionStatus =
  | { phase: "idle"; pendingEvents: number }
  | { phase: "connecting"; attempt: number; pendingEvents: number }
  | { phase: "connected"; pendingEvents: number }
  | { phase: "reconnecting"; attempt: number; retryInMs: number; pendingEvents: number }
  | { phase: "stopped"; pendingEvents: number };

export interface DurableRoomMessage extends Record<string, unknown> {
  type: DurableRoomEventType;
}

interface OutboxEntry {
  clientEventId: string;
  queuedAtMs: number;
  message: DurableRoomMessage & { clientEventId: string };
}

interface PersistedTransportState {
  version: 1;
  lastSequence: number;
  outbox: OutboxEntry[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ReliableRoomClientOptions {
  url: string;
  storageKey: string;
  issueCredential: () => Promise<string>;
  onMessage: (message: Record<string, unknown>) => void;
  onStatus?: (status: RoomConnectionStatus) => void;
  onError?: (error: Error) => void;
  storage?: StorageLike;
  socketFactory?: (url: string, protocols: string[]) => WebSocket;
  idFactory?: () => string;
  now?: () => number;
  random?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxOutboxEntries?: number;
}

const OPEN = 1;
const CLOSING = 2;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isOutboxEntry(value: unknown): value is OutboxEntry {
  const entry = asRecord(value);
  const message = asRecord(entry?.message);
  return Boolean(
    entry &&
    typeof entry.clientEventId === "string" &&
    entry.clientEventId.length > 0 &&
    typeof entry.queuedAtMs === "number" &&
    message &&
    message.clientEventId === entry.clientEventId &&
    DURABLE_ROOM_EVENT_TYPES.includes(message.type as DurableRoomEventType),
  );
}

/**
 * Authenticated ACE room transport with a persistent research-event outbox.
 *
 * Signaling and raw captions remain ephemeral because replaying either after a
 * reconnect would corrupt WebRTC negotiation or caption order. Observations
 * that belong in the evidence record are persisted until the room confirms the
 * authoritative SQLite sequence assigned to them.
 */
export class ReliableRoomClient {
  private readonly storage: StorageLike;
  private readonly socketFactory: (url: string, protocols: string[]) => WebSocket;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: ReliableRoomClientOptions["setTimer"];
  private readonly clearTimer: ReliableRoomClientOptions["clearTimer"];
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly maxOutboxEntries: number;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: OutboxEntry[] = [];
  private readonly sentOnConnection = new Set<string>();
  private lastSequence = 0;
  private retryAttempt = 0;
  private connectionGeneration = 0;
  private connecting = false;
  private stopped = true;
  private welcomed = false;

  constructor(private readonly options: ReliableRoomClientOptions) {
    this.storage = options.storage ?? localStorage;
    this.socketFactory = options.socketFactory ?? ((url, protocols) => new WebSocket(url, protocols));
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.retryMaxMs = options.retryMaxMs ?? 15_000;
    this.maxOutboxEntries = options.maxOutboxEntries ?? 5_000;
    this.restore();
    this.report({ phase: "idle", pendingEvents: this.outbox.length });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.connectionGeneration += 1;
    if (this.reconnectTimer !== null) {
      this.clearTimer?.(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.welcomed = false;
    this.sentOnConnection.clear();
    if (socket && socket.readyState < CLOSING) socket.close(1000, "client stopped");
    this.report({ phase: "stopped", pendingEvents: this.outbox.length });
  }

  sendEphemeral(message: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN || !this.welcomed) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (reason) {
      this.handleSocketFailure(socket, reason);
      return false;
    }
  }

  sendDurable(message: DurableRoomMessage, clientEventId = this.idFactory()): string {
    if (this.outbox.some((entry) => entry.clientEventId === clientEventId)) return clientEventId;
    if (this.outbox.length >= this.maxOutboxEntries) {
      throw new Error("The room event outbox is full; research observations were not discarded");
    }
    const entry: OutboxEntry = {
      clientEventId,
      queuedAtMs: this.now(),
      message: { ...message, clientEventId },
    };
    this.outbox.push(entry);
    try {
      this.persist();
    } catch (reason) {
      this.outbox.pop();
      throw reason;
    }
    this.flush();
    return clientEventId;
  }

  pendingEventCount(): number {
    return this.outbox.length;
  }

  authoritativeSequence(): number {
    return this.lastSequence;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.socket || this.reconnectTimer !== null) return;
    this.connecting = true;
    const generation = ++this.connectionGeneration;
    this.report({
      phase: "connecting",
      attempt: this.retryAttempt + 1,
      pendingEvents: this.outbox.length,
    });
    try {
      const credential = await this.options.issueCredential();
      if (this.stopped || generation !== this.connectionGeneration) return;
      const socket = this.socketFactory(this.options.url, [
        "ace-omni.v1",
        `credential.${credential}`,
      ]);
      this.socket = socket;
      this.welcomed = false;
      this.sentOnConnection.clear();
      socket.addEventListener("open", () => {
        if (this.socket !== socket || this.stopped) return;
        this.retryAttempt = 0;
      });
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket || this.stopped) return;
        this.receive(event.data);
      });
      socket.addEventListener("close", () => {
        this.handleSocketFailure(socket);
      });
      socket.addEventListener("error", () => {
        this.handleSocketFailure(socket, new Error("Authenticated room WebSocket failed"));
      });
    } catch (reason) {
      if (!this.stopped && generation === this.connectionGeneration) {
        this.reportError(reason);
        this.scheduleReconnect();
      }
    } finally {
      this.connecting = false;
    }
  }

  private receive(data: unknown): void {
    let message: Record<string, unknown> | null = null;
    try {
      message = asRecord(JSON.parse(String(data)));
    } catch (reason) {
      this.reportError(new Error(`Room sent invalid JSON: ${String(reason)}`));
    }
    if (!message) return;

    if (message.type === "event_ack" && typeof message.clientEventId === "string") {
      const pendingIndex = this.outbox.findIndex(
        (entry) => entry.clientEventId === message.clientEventId,
      );
      if (pendingIndex >= 0) {
        this.outbox.splice(pendingIndex, 1);
        this.persistSafely();
      }
      this.sentOnConnection.delete(message.clientEventId);
      this.advanceSequence(message.sequence);
      if (this.socket?.readyState === OPEN) {
        this.report({ phase: "connected", pendingEvents: this.outbox.length });
      }
      this.options.onMessage(message);
      return;
    }

    if (message.type === "welcome" && typeof message.lastSequence === "number") {
      this.welcomed = true;
      if (message.lastSequence >= this.lastSequence) {
        this.lastSequence = message.lastSequence;
        this.persistSafely();
        this.options.onMessage(message);
      }
      this.report({ phase: "connected", pendingEvents: this.outbox.length });
      this.flush();
      return;
    }

    if (typeof message.sequence === "number") {
      if (!Number.isInteger(message.sequence) || message.sequence <= this.lastSequence) return;
      this.lastSequence = message.sequence;
      this.persistSafely();
    }
    this.options.onMessage(message);
  }

  private advanceSequence(value: unknown): void {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= this.lastSequence) return;
    this.lastSequence = value;
    this.persistSafely();
  }

  private flush(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN || !this.welcomed) return;
    for (const entry of this.outbox) {
      if (this.sentOnConnection.has(entry.clientEventId)) continue;
      try {
        socket.send(JSON.stringify(entry.message));
        this.sentOnConnection.add(entry.clientEventId);
      } catch (reason) {
        this.handleSocketFailure(socket, reason);
        return;
      }
    }
    this.report({ phase: "connected", pendingEvents: this.outbox.length });
  }

  private handleSocketFailure(socket: WebSocket, reason?: unknown): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.welcomed = false;
    this.sentOnConnection.clear();
    if (reason) this.reportError(reason);
    if (socket.readyState < CLOSING) socket.close(1012, "reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const exponential = Math.min(
      this.retryMaxMs,
      this.retryBaseMs * (2 ** Math.min(this.retryAttempt, 12)),
    );
    const retryInMs = Math.max(0, Math.round(exponential * (0.8 + this.random() * 0.4)));
    this.retryAttempt += 1;
    this.report({
      phase: "reconnecting",
      attempt: this.retryAttempt,
      retryInMs,
      pendingEvents: this.outbox.length,
    });
    this.reconnectTimer = this.setTimer?.(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, retryInMs) ?? null;
  }

  private restore(): void {
    try {
      const raw = this.storage.getItem(this.options.storageKey);
      if (!raw) return;
      const parsed = asRecord(JSON.parse(raw));
      if (parsed?.version !== 1 || !Array.isArray(parsed.outbox)) return;
      this.lastSequence = typeof parsed.lastSequence === "number" && Number.isInteger(parsed.lastSequence)
        ? Math.max(0, parsed.lastSequence)
        : 0;
      this.outbox = parsed.outbox.filter(isOutboxEntry).slice(-this.maxOutboxEntries);
    } catch (reason) {
      this.reportError(new Error(`Unable to restore the room outbox: ${String(reason)}`));
    }
  }

  private persist(): void {
    const state: PersistedTransportState = {
      version: 1,
      lastSequence: this.lastSequence,
      outbox: this.outbox,
    };
    this.storage.setItem(this.options.storageKey, JSON.stringify(state));
  }

  private persistSafely(): void {
    try {
      this.persist();
    } catch (reason) {
      this.reportError(new Error(`Unable to persist the room outbox: ${String(reason)}`));
    }
  }

  private report(status: RoomConnectionStatus): void {
    this.options.onStatus?.(status);
  }

  private reportError(reason: unknown): void {
    this.options.onError?.(reason instanceof Error ? reason : new Error(String(reason)));
  }
}
