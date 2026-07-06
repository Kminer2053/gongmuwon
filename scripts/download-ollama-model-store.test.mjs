import assert from "node:assert/strict";

import { parseModelRef } from "./download-ollama-model-store.mjs";

assert.deepEqual(parseModelRef("gemma4:e2b"), { modelName: "gemma4", tag: "e2b" });
assert.deepEqual(parseModelRef("nomic-embed-text"), { modelName: "nomic-embed-text", tag: "latest" });
assert.throws(() => parseModelRef("google/gemma-4-e2b-it"), /Only Ollama library model refs/);
