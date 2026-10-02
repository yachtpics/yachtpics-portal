# /depth/v1 — the Walkthrough look's depth model

Everything the Walkthrough reel look needs to read the depth of a photograph,
served by the portal itself. Nothing here is fetched from a third party or a
CDN at runtime, and no photograph leaves the broker's browser.

Loaded only when an (admin) Walkthrough render starts — `src/lib/depthMotion.ts`
starts `worker.mjs` as a module Web Worker, and the worker loads the rest.

| File | What it is | Size | Source | Licence |
|---|---|---|---|---|
| `depth-anything-v2-small-q8.onnx` | Depth Anything V2 Small, 8-bit quantized ONNX (`onnx/model_quantized.onnx`) | 27,258,801 B | Hugging Face `onnx-community/depth-anything-v2-small`, commit `4472b7362082ad9968fee890ca0f1e5aca36b93d` (converted from `depth-anything/Depth-Anything-V2-Small`) | Apache-2.0 |
| `ort.wasm.min.mjs` | onnxruntime-web 1.30.0, WebAssembly-only ESM build (`dist/ort.wasm.min.mjs`) | 50,126 B | npm `onnxruntime-web@1.30.0` | MIT |
| `ort-wasm-simd-threaded.mjs` | the runtime's Emscripten glue (`dist/ort-wasm-simd-threaded.mjs`) | 24,381 B | npm `onnxruntime-web@1.30.0` | MIT |
| `ort-wasm-simd-threaded.wasm` | the runtime itself (`dist/ort-wasm-simd-threaded.wasm`) | 14,239,897 B | npm `onnxruntime-web@1.30.0` | MIT |
| `worker.mjs` | ours: loads the model, answers `{id, rgba, width, height}` with `{id, depth, width, height}` | small | this repo | — |

SHA-256:

```
fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d  depth-anything-v2-small-q8.onnx
219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b  ort.wasm.min.mjs
e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b  ort-wasm-simd-threaded.mjs
3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2  ort-wasm-simd-threaded.wasm
```

Re-fetch:

- Model: `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx`
- Runtime: `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz`, files under `package/dist/`.

Notes:

- onnxruntime-web is **not** a dependency in `package.json` and is never
  imported through webpack; these files are copied in by hand.
- The runtime runs single-threaded (`numThreads = 1`): the "threaded" build
  works without threads, and real threads would need cross-origin isolation
  headers the portal does not send.
- `ort.wasm.min.mjs` ends with a `sourceMappingURL` comment; the `.map` file is
  not shipped, so the browser's developer tools show a harmless 404 for it.
- `next.config.mjs` serves `/depth/*` with `Cache-Control: public,
  max-age=31536000, immutable`. That is only safe because the folder is
  versioned.

## Updating

Never change a file in place. Make `public/depth/v2/` with the new files, point
`ASSET_BASE` in `src/lib/depthMotion.ts` at it, update this table and the
hashes, and delete `v1` once nothing references it. If the runtime's file
names change in a new release (check `dist/` for the WASM-only `.mjs` and the
`.wasm` + `.mjs` pair it loads), update the import in `worker.mjs` too.
