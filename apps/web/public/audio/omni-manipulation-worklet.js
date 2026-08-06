/**
 * ACE Omni deterministic audio manipulation processor.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
class AceOmniManipulationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.commands = [];
    this.port.onmessage = (event) => {
      const command = event.data;
      if (
        !command ||
        command.kind !== "schedule" ||
        typeof command.id !== "string" ||
        !Number.isSafeInteger(command.startFrame) ||
        !Number.isSafeInteger(command.endFrame) ||
        command.endFrame <= command.startFrame
      ) return;
      this.commands = this.commands.filter((entry) => entry.id !== command.id);
      this.commands.push({
        ...command,
        randomState: command.seed >>> 0,
        filterState: [],
        notifiedStart: false,
        notifiedEnd: false,
      });
      this.commands.sort((left, right) =>
        left.startFrame - right.startFrame || left.id.localeCompare(right.id));
    };
  }

  nextRandom(command) {
    command.randomState = (command.randomState + 0x6d2b79f5) >>> 0;
    let value = command.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  apply(command, sample, frame, channel) {
    const parameters = command.parameters || {};
    if (command.type === "gain") {
      const gainDb = Number(parameters.gainDb ?? 0);
      return sample * Math.pow(10, Math.max(-60, Math.min(20, gainDb)) / 20);
    }
    if (command.type === "background_noise") {
      const gainDb = Number(parameters.gainDb ?? -18);
      const gain = Math.pow(10, Math.max(-60, Math.min(0, gainDb)) / 20);
      return sample + (this.nextRandom(command) * 2 - 1) * gain;
    }
    if (command.type === "packet_drop") {
      const intervalFrames = Math.max(1, Math.round(
        (Number(parameters.intervalMs ?? 1000) / 1000) * sampleRate));
      const durationFrames = Math.max(1, Math.round(
        (Number(parameters.durationMs ?? 250) / 1000) * sampleRate));
      return ((frame - command.startFrame) % intervalFrames) < durationFrames ? 0 : sample;
    }
    if (command.type === "audio_filter") {
      const frequencyHz = Math.max(20, Math.min(sampleRate / 2 - 1, Number(parameters.frequencyHz ?? 3000)));
      const alpha = 1 - Math.exp((-2 * Math.PI * frequencyHz) / sampleRate);
      const previous = command.filterState[channel] ?? 0;
      const lowpass = previous + alpha * (sample - previous);
      command.filterState[channel] = lowpass;
      return parameters.type === "highpass" ? sample - lowpass : lowpass;
    }
    return sample;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frameCount = output[0]?.length ?? 128;

    for (const command of this.commands) {
      if (!command.notifiedStart && currentFrame + frameCount > command.startFrame) {
        command.notifiedStart = true;
        this.port.postMessage({ kind: "executed", id: command.id, frame: command.startFrame });
      }
      if (!command.notifiedEnd && currentFrame >= command.endFrame) {
        command.notifiedEnd = true;
        this.port.postMessage({ kind: "completed", id: command.id, frame: command.endFrame });
      }
    }

    for (let channel = 0; channel < output.length; channel += 1) {
      const source = input[channel] || input[0];
      const destination = output[channel];
      for (let index = 0; index < destination.length; index += 1) {
        const frame = currentFrame + index;
        let sample = source?.[index] ?? 0;
        for (const command of this.commands) {
          if (frame >= command.startFrame && frame < command.endFrame) {
            sample = this.apply(command, sample, frame, channel);
          }
        }
        destination[index] = Math.max(-1, Math.min(1, sample));
      }
    }
    this.commands = this.commands.filter((command) => !command.notifiedEnd);
    return true;
  }
}

registerProcessor("ace-omni-manipulation", AceOmniManipulationProcessor);
