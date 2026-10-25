// Depth worker for the Walkthrough reel look.
//
// Runs Depth Anything V2 Small (quantized) on the WebAssembly runtime, one
// photograph at a time. This file and the runtime's small scripts are always
// served by the portal itself (same-origin). The two big files — the model and
// the runtime's .wasm — come from the portal's own Supabase Storage bucket
// (`portal-assets`) when the page passes their URLs as query parameters:
//
//   worker.mjs?model=<absolute .onnx URL>&wasm=<absolute .wasm URL>
//
// (src/lib/depthMotion.ts does that when NEXT_PUBLIC_ASSETS_BASE is set).
// Without them, both are loaded from this folder, as before. Either way no
// photograph leaves the browser and nothing comes from a third-party CDN.
//
// Message in:  { id, rgba: Uint8ClampedArray, width, height }
//              — the photograph already resized to the model's input size
//                (both sides multiples of 14).
// Message out: { id, depth: Float32Array, width, height }  (buffer transferred)
//          or: { id, error: string }
//
// The output is the model's raw relative inverse depth (bigger = nearer);
// the page normalises and smooths it.

import * as ort from "./ort.wasm.min.mjs";

const HERE = new URL("./", import.meta.url).href;
const PARAMS = new URL(import.meta.url).searchParams;

// Only absolute http(s) URLs are accepted from the query string.
function remote(name) {
  const v = PARAMS.get(name);
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

const MODEL_URL = remote("model") || new URL("depth-anything-v2-small-q8.onnx", HERE).href;
const WASM_URL = remote("wasm");

// Single-threaded on purpose: threads need cross-origin isolation headers the
// portal does not send, and one photograph at a time is fast enough.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
// The Emscripten glue (.mjs) always comes from this folder; the .wasm from the
// bucket when given. ORT fetches it with fetch() (CORS mode for a
// cross-origin URL; Supabase answers with Access-Control-Allow-Origin: *).
ort.env.wasm.wasmPaths = WASM_URL
  ? { mjs: new URL("ort-wasm-simd-threaded.mjs", HERE).href, wasm: WASM_URL }
  : HERE;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;

const SESSION_OPTIONS = {
  executionProviders: ["wasm"],
  graphOptimizationLevel: "all",
};

// A model from the bucket is fetched here, explicitly as a CORS request, so a
// missing or blocked file fails with a clear error. The local model is handed
// to ORT as a URL, exactly as before.
async function loadRemoteModel(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`depth model: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function session() {
  if (!sessionPromise) {
    sessionPromise = remote("model")
      ? loadRemoteModel(MODEL_URL).then((bytes) => ort.InferenceSession.create(bytes, SESSION_OPTIONS))
      : ort.InferenceSession.create(MODEL_URL, SESSION_OPTIONS);
  }
  return sessionPromise;
}

self.onmessage = async (e) => {
  const { id, rgba, width, height } = e.data || {};
  try {
    if (!rgba || !width || !height) throw new Error("bad request");
    const plane = width * height;
    const x = new Float32Array(plane * 3);
    // RGBA (row-major, top row first) → normalised float32, NCHW.
    for (let p = 0, q = 0; p < plane; p++, q += 4) {
      x[p] = (rgba[q] / 255 - MEAN[0]) / STD[0];
      x[plane + p] = (rgba[q + 1] / 255 - MEAN[1]) / STD[1];
      x[plane * 2 + p] = (rgba[q + 2] / 255 - MEAN[2]) / STD[2];
    }
    const sess = await session();
    const input = new ort.Tensor("float32", x, [1, 3, height, width]);
    const out = await sess.run({ pixel_values: input });
    const t = out.predicted_depth ?? out[sess.outputNames[0]];
    const dims = t.dims;
    const oh = dims[dims.length - 2];
    const ow = dims[dims.length - 1];
    // A copy we own, so the buffer can be handed over without a second copy.
    const depth = new Float32Array(t.data);
    if (typeof t.dispose === "function") t.dispose();
    self.postMessage({ id, depth, width: ow, height: oh }, [depth.buffer]);
  } catch (err) {
    // A failed session load is not retried in this worker: the page falls
    // back to the flat zoom for every photograph instead.
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
