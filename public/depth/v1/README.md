# /depth/v1 — the Walkthrough look's depth model

Everything the Walkthrough reel look needs to read the depth of a photograph.
Nothing is fetched from a third-party CDN at runtime, and no photograph leaves
the broker's browser.

Loaded only when an (admin) Walkthrough render starts — `src/lib/depthMotion.ts`
starts `worker.mjs` as a module Web Worker, and the worker loads the rest.

## Where the files are served from (Oct 25)

- **Always same-origin, from this folder:** `worker.mjs`, `ort.wasm.min.mjs`,
  `ort-wasm-simd-threaded.mjs` (a module Worker and what it imports must be
  same-origin).
- **The two big files** — `depth-anything-v2-small-q8.onnx` (27 MB) and
  `ort-wasm-simd-threaded.wasm` (14 MB) — come from the portal's public
  Supabase Storage bucket **`portal-assets`**, at `depth/v1/<file>`, when
  **`NEXT_PUBLIC_ASSETS_BASE`** is set (value:
  `https://<project>.supabase.co/storage/v1/object/public/portal-assets/`).
  `depthMotion.ts` then starts the worker as
  `worker.mjs?model=<bucket .onnx URL>&wasm=<bucket .wasm URL>`; the worker
  fetches the model with a CORS `fetch` and sets ORT's
  `env.wasm.wasmPaths = { mjs: <this folder>/ort-wasm-simd-threaded.mjs, wasm: <bucket .wasm URL> }`.
  Supabase serves public objects with `Access-Control-Allow-Origin: *`, and the
  portal sends no COOP/COEP headers, so this works from the worker.
- **Variable unset** (local dev, or before the upload): everything loads from
  this folder exactly as before.
- Upload / re-upload: `node scripts/upload-public-assets.mjs` (from the portal
  root; reads `.env.local`). Cache-Control on the bucket copies: 1 year.
- `.vercelignore` keeps the two big files out of deployments; they stay in the
  repo so local dev works. A new version still goes in a new folder
  (`depth/v2/`) — upload it to the bucket under the same new path.

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
  max-age=31536000, immutable`; the upload script gives the bucket copies
  `max-age=31536000`. That is only safe because the folder is versioned.

## Updating

Never change a file in place. Make `public/depth/v2/` with the new files, point
`ASSET_BASE` (and the `depth/v1/` paths passed to `assetUrl`) in
`src/lib/depthMotion.ts` at it, add the new big files to the upload script and
`.vercelignore`, run the upload, update this table and the
hashes, and delete `v1` once nothing references it. If the runtime's file
names change in a new release (check `dist/` for the WASM-only `.mjs` and the
`.wasm` + `.mjs` pair it loads), update the import in `worker.mjs` too.
