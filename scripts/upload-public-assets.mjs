// Upload the portal's large static assets to Supabase Storage.
//
// The Walkthrough depth model + WebAssembly runtime (~41 MB) and the reel
// music sample packs (~5 MB) no longer need to ship inside every Vercel
// deployment. This copies them to the PUBLIC bucket `portal-assets`, at the
// same relative paths they have under public/:
//
//   depth/v1/depth-anything-v2-small-q8.onnx
//   depth/v1/ort-wasm-simd-threaded.wasm
//   music/index.json, music/*.bin
//
// The app reads them from there once NEXT_PUBLIC_ASSETS_BASE is set (see
// src/lib/assetBase.ts); without it, it keeps using the public/ copies.
//
// Run from the portal root (reads .env.local for NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY):
//
//   node scripts/upload-public-assets.mjs
//
// Idempotent: creates the bucket only if missing, overwrites (upsert) files.

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "portal-assets";
// 50 MB: the largest file is the ~27 MB model. (Supabase Free caps uploads at
// 50 MB project-wide, and a bucket limit above the project limit is refused.)
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;
const YEAR = "31536000";
// The index is small and must change together with the packs; a short cache
// means a re-rendered index is picked up within minutes. (Re-rendered packs
// should still go out under new names / a new folder — browsers may keep the
// old .bin files for up to a year.)
const INDEX_CACHE = "300";

if (!existsSync(".env.local")) {
  console.error("Run this from the portal root (no .env.local here).");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const TYPES = {
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

// [local path under public/, path in the bucket]
const files = [
  "depth/v1/depth-anything-v2-small-q8.onnx",
  "depth/v1/ort-wasm-simd-threaded.wasm",
  ...readdirSync(join("public", "music"))
    .filter((f) => f.endsWith(".bin") || f === "index.json")
    .sort()
    .map((f) => `music/${f}`),
];

// 1. The bucket.
const { data: existing, error: getErr } = await supabase.storage.getBucket(BUCKET);
if (getErr && !/not found/i.test(getErr.message || "")) {
  console.error(`Couldn't check bucket ${BUCKET}: ${getErr.message}`);
  process.exit(1);
}
if (!existing) {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: FILE_SIZE_LIMIT,
  });
  if (error) {
    console.error(`Couldn't create bucket ${BUCKET}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Created public bucket ${BUCKET}.`);
} else {
  if (!existing.public || (existing.file_size_limit && existing.file_size_limit < FILE_SIZE_LIMIT)) {
    const { error } = await supabase.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
    });
    if (error) {
      console.error(`Couldn't update bucket ${BUCKET}: ${error.message}`);
      process.exit(1);
    }
    console.log(`Bucket ${BUCKET}: made public / raised size limit.`);
  } else {
    console.log(`Bucket ${BUCKET} already exists (public).`);
  }
}

// 2. The files.
let failed = 0;
for (const path of files) {
  const local = join("public", path);
  if (!existsSync(local)) {
    console.error(`  MISSING locally: ${local}`);
    failed++;
    continue;
  }
  const body = readFileSync(local);
  const contentType = TYPES[extname(path)] || "application/octet-stream";
  const cacheControl = path === "music/index.json" ? INDEX_CACHE : YEAR;
  const mb = (statSync(local).size / 1048576).toFixed(1);
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType,
    cacheControl,
    upsert: true,
  });
  if (error) {
    console.error(`  FAILED ${path} (${mb} MB): ${error.message}`);
    failed++;
    continue;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log(`  ok  ${path} (${mb} MB)  ${data.publicUrl}`);
}

const base = `${url.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/`;
console.log("");
if (failed) {
  console.error(`${failed} file(s) failed — fix and run again before setting the variable.`);
  process.exit(1);
}
console.log("All uploaded. Set this in Vercel (Production + Preview), then redeploy:");
console.log("");
console.log(`  NEXT_PUBLIC_ASSETS_BASE=${base}`);
console.log("");
console.log("Check one file opens in a browser:");
console.log(`  ${base}music/index.json`);
