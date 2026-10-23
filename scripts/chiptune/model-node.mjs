import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// tfjs IOHandler that reads the Basic Pitch weights straight off disk.
export function diskModel() {
  const dir = fileURLToPath(new URL("../../public/models/basic-pitch/", import.meta.url));
  const json = JSON.parse(readFileSync(dir + "model.json", "utf8"));
  return {
    load: async () => {
      const specs = json.weightsManifest.flatMap((g) => g.weights);
      const parts = json.weightsManifest.flatMap((g) => g.paths.map((p) => readFileSync(dir + p)));
      const all = Buffer.concat(parts);
      return { modelTopology: json.modelTopology, format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy, weightSpecs: specs, weightData: all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength), signature: json.signature, userDefinedMetadata: json.userDefinedMetadata };
    },
  };
}
