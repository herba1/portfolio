import { TAPE_HEAD_SOURCE, TAPE_WORKLET_SOURCE } from "./tapeWorklet";

const FADE_IN_SECONDS = 0.04;
const LATENCY_LIMIT = 0.3;

function claimPlayback() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {
    return;
  }
}

export function createTapeAudio() {
  let context = null;
  let master = null;
  let node = null;
  let processor = null;
  let dsp = null;
  let moduleUrl = null;
  let pendingLoad = null;
  let destroyed = false;

  const flush = () => {
    if (!pendingLoad) return;
    if (node) {
      const { levels, sourceRate } = pendingLoad;
      node.port.postMessage(
        { type: "load", levels, sourceRate },
        levels.map((level) => level.buffer),
      );
      pendingLoad = null;
    } else if (dsp) {
      dsp.load(pendingLoad.levels, pendingLoad.sourceRate);
      pendingLoad = null;
    }
  };

  const startScriptProcessor = () => {
    if (destroyed || !context || processor) return;
    try {
      const Dsp = new Function(`${TAPE_HEAD_SOURCE}\nreturn TapeHeadDsp;`)();
      dsp = new Dsp(context.sampleRate);
      processor = context.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => {
        const channel = event.outputBuffer.getChannelData(0);
        dsp.render(channel, channel.length, context.currentTime);
      };
      processor.connect(master);
      flush();
    } catch {
      dsp = null;
      processor = null;
    }
  };

  const ensure = () => {
    if (destroyed) return false;
    if (context) {
      if (context.state === "suspended") context.resume().catch(() => null);
      return true;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    claimPlayback();
    context = new Context({ latencyHint: "interactive" });
    context.resume().catch(() => null);
    master = context.createGain();
    master.gain.value = 0;
    master.gain.setTargetAtTime(1, context.currentTime, FADE_IN_SECONDS);
    master.connect(context.destination);
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      moduleUrl = URL.createObjectURL(new Blob([TAPE_WORKLET_SOURCE], { type: "text/javascript" }));
      context.audioWorklet
        .addModule(moduleUrl)
        .then(() => {
          if (destroyed) return;
          node = new AudioWorkletNode(context, "tape-head", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          node.connect(master);
          flush();
        })
        .catch(startScriptProcessor)
        .finally(() => {
          if (moduleUrl) URL.revokeObjectURL(moduleUrl);
          moduleUrl = null;
        });
    } else {
      startScriptProcessor();
    }
    return true;
  };

  return {
    ensure,
    load(levels, sourceRate) {
      pendingLoad = { levels, sourceRate };
      flush();
    },
    steer(position, velocity) {
      if (!context || context.state !== "running") return;
      if (node) node.port.postMessage({ type: "steer", position, velocity, at: context.currentTime });
      else if (dsp) dsp.steer(position, velocity, context.currentTime);
    },
    suspend() {
      if (context && context.state === "running") context.suspend().catch(() => null);
    },
    resume() {
      if (context && context.state === "suspended") context.resume().catch(() => null);
    },
    get started() {
      return Boolean(context);
    },
    get latency() {
      if (!context || context.state !== "running") return 0;
      const output = Number.isFinite(context.outputLatency) ? context.outputLatency : 0;
      const base = Number.isFinite(context.baseLatency) ? context.baseLatency : 0;
      return Math.min(LATENCY_LIMIT, Math.max(0, output + base));
    },
    destroy() {
      destroyed = true;
      if (node) {
        node.port.onmessage = null;
        node.disconnect();
      }
      if (processor) {
        processor.onaudioprocess = null;
        processor.disconnect();
      }
      if (master) master.disconnect();
      if (context) context.close().catch(() => null);
      if (moduleUrl) URL.revokeObjectURL(moduleUrl);
      node = null;
      processor = null;
      dsp = null;
      context = null;
      pendingLoad = null;
    },
  };
}
