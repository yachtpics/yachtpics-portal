"""NOTE (Oct 23, 2026): the packs in public/music were rendered with this script
and then the index.json offsets were corrected by hand against the real ID3
boundaries in each .bin (the copies that landed in the repo did not match the
offsets this script wrote). If you re-render, rebuild the index by scanning for
the b"ID3" markers in each .bin rather than trusting the offsets written here,
and check with the sampler's pack verification before committing.

Render per-note instrument samples from FluidR3_GM.sf2 (MIT, Frank Wen) into
one packed .bin per instrument plus a JSON index, for the Portal's reel composer.

Pack layout: the mp3 files for each note, concatenated; index.json lists for each
instrument {file, notes: [{midi, offset, length, seconds}], release}. The browser
slices the ArrayBuffer and decodeAudioData()s each slice.
"""
import json, os, subprocess, sys, struct
import numpy as np
import fluidsynth

SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
OUT = sys.argv[1]
SR = 44100
BR = "80k"

# name, bank, program, low, high, step, hold_sec, release_sec, velocity
INSTR = [
    ("piano",   0, 0,  33, 96, 3, 5.0, 2.0, 96),   # Acoustic Grand
    ("epiano",  0, 4,  36, 91, 3, 4.0, 2.0, 96),   # Electric Piano 1 (Rhodes)
    ("strings", 0, 48, 36, 91, 3, 7.0, 2.5, 90),   # String Ensemble 1
    ("pad",     0, 89, 36, 84, 4, 7.0, 3.0, 90),   # Pad 2 (warm)
    ("nylon",   0, 24, 40, 84, 3, 3.0, 1.0, 100),  # Nylon guitar
    ("bass",    0, 33, 28, 55, 3, 2.5, 0.8, 100),  # Electric bass (finger)
    ("vibes",   0, 11, 48, 96, 3, 3.0, 1.5, 96),   # Vibraphone
    ("glock",   0, 9,  72, 108, 4, 2.0, 1.0, 96),  # Glockenspiel
]
# Drum kit hits (bank 128, Standard kit), midi note → name
DRUMS = [("kick", 36), ("kick2", 35), ("snare", 38), ("rim", 37), ("snap", 39),
         ("hat", 42), ("hat_open", 46), ("shaker", 82), ("ride", 51),
         ("tom_lo", 45), ("tom_hi", 48), ("crash", 49), ("tamb", 54)]

def render(fs, chan, note, vel, hold, release):
    fs.noteon(chan, note, vel)
    a = fs.get_samples(int(SR * hold))
    fs.noteoff(chan, note)
    b = fs.get_samples(int(SR * release))
    x = np.concatenate([a, b]).astype(np.float32) / 32768.0
    x = x.reshape(-1, 2).mean(axis=1)  # mono
    # trim trailing silence (< -60 dBFS), keep 50 ms
    thr = 10 ** (-60 / 20)
    nz = np.nonzero(np.abs(x) > thr)[0]
    end = (nz[-1] + int(SR * 0.05)) if len(nz) else len(x)
    x = x[: min(end, len(x))]
    peak = float(np.max(np.abs(x))) or 1.0
    return x / peak * 0.891  # -1 dBFS

def encode(x, path):
    raw = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1",
                    "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", BR, path], input=raw, check=True)

os.makedirs(OUT, exist_ok=True)
index = {"license": "Samples rendered from FluidR3_GM.sf2 by Frank Wen (MIT). Rendered for YachtPics with FluidSynth.",
         "sampleRate": SR, "instruments": {}}

for name, bank, prog, lo, hi, step, hold, rel, vel in INSTR:
    fs = fluidsynth.Synth(samplerate=SR, gain=0.6)
    sfid = fs.sfload(SF2)
    fs.program_select(0, sfid, bank, prog)
    fs.setting("synth.reverb.active", 0); fs.setting("synth.chorus.active", 0)
    notes, blob = [], bytearray()
    for midi in range(lo, hi + 1, step):
        x = render(fs, 0, midi, vel, hold, rel)
        tmp = f"{OUT}/_tmp.mp3"; encode(x, tmp)
        data = open(tmp, "rb").read()
        notes.append({"midi": midi, "offset": len(blob), "length": len(data), "seconds": round(len(x) / SR, 2)})
        blob += data
    fs.delete()
    open(f"{OUT}/{name}.bin", "wb").write(blob)
    index["instruments"][name] = {"file": f"{name}.bin", "hold": hold, "release": rel, "notes": notes}
    print(name, len(notes), "notes", len(blob) // 1024, "KB")

# drums
fs = fluidsynth.Synth(samplerate=SR, gain=0.6)
sfid = fs.sfload(SF2)
fs.program_select(9, sfid, 128, 0)
fs.setting("synth.reverb.active", 0); fs.setting("synth.chorus.active", 0)
notes, blob = [], bytearray()
for dname, midi in DRUMS:
    x = render(fs, 9, midi, 110, 1.5, 1.0)
    tmp = f"{OUT}/_tmp.mp3"; encode(x, tmp)
    data = open(tmp, "rb").read()
    notes.append({"name": dname, "midi": midi, "offset": len(blob), "length": len(data), "seconds": round(len(x) / SR, 2)})
    blob += data
fs.delete()
open(f"{OUT}/drums.bin", "wb").write(blob)
index["instruments"]["drums"] = {"file": "drums.bin", "hold": 1.5, "release": 1.0, "notes": notes}
print("drums", len(notes), len(blob) // 1024, "KB")
os.remove(f"{OUT}/_tmp.mp3")
json.dump(index, open(f"{OUT}/index.json", "w"), separators=(",", ":"))
