// Depth worker for the Walkthrough reel look.
//
// Runs Depth Anything V2 Small (quantized) on the WebAssembly runtime, one
// photograph at a time, entirely inside this folder: the model, the runtime
// and this file are all served by the portal itself. Nothing goes to a third
// party and nothing is fetched from a CDN.
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
const MODEL_URL = new URL("depth-anything-v2-small-q8.onnx", HERE).href;

// Single-threaded on purpose: threads need cross-origin isolation headers the
// portal does not send, and one photograph at a time is fast enough.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = HERE;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;

function session() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
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
