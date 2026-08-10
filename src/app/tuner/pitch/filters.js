const HIGHPASS_STAGES = 2;
const HIGHPASS_RATIO = 0.55;
const MAINS_FREQUENCIES = [50, 60];
const MAINS_Q = 30;
const LOWPASS_RATIO = 3.2;

export function buildInputChain(context, { lowestFrequency, highestFrequency }) {
  const nodes = [];
  const corner = Math.max(18, lowestFrequency * HIGHPASS_RATIO);

  for (let stage = 0; stage < HIGHPASS_STAGES; stage++) {
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = corner;
    highpass.Q.value = Math.SQRT1_2;
    nodes.push(highpass);
  }

  if (lowestFrequency >= 70) {
    for (const frequency of MAINS_FREQUENCIES) {
      const notch = context.createBiquadFilter();
      notch.type = "notch";
      notch.frequency.value = frequency;
      notch.Q.value = MAINS_Q;
      nodes.push(notch);
    }
  }

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = Math.min(
    context.sampleRate * 0.45,
    highestFrequency * LOWPASS_RATIO
  );
  lowpass.Q.value = Math.SQRT1_2;
  nodes.push(lowpass);

  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);

  return { input: nodes[0], output: nodes[nodes.length - 1], nodes };
}

export function disconnectChain(chain) {
  if (!chain) return;
  for (const node of chain.nodes) {
    try {
      node.disconnect();
    } catch {}
  }
}
