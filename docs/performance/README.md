# Render performance checks

The stabilization work bounds footage extraction and audio transport without changing their sampled output.

A 4-second, 25 fps moving source rendered at 30 fps produces 120 JPEGs when fully extracted. The integration
fixture's still, three-cell contact sheet, and three-frame range render together retain five source frames.
Their pixels match the corresponding full-decode references exactly, and the cache uses less than 10% of the
full reference's bytes. Repeating a command reuses existing frames. Previews decode one-second batches, with
at most two ffmpeg decoders per project server. Source resolution is retained to preserve zoom and render detail;
ffmpeg may still decode earlier frames to preserve exact frame sampling.

`smashcut cache <dir>` reports generated entries and byte usage. `--prune` removes stale source versions,
legacy-format entries, and interrupted temporary work older than 24 hours. It preserves source assets, voice
takes, render output, current cache entries and recent temporary jobs. Stop previews and renders before pruning.

Audio export mixes once, transfers at most 32,768 stereo samples (128 KiB PCM) per request, writes each chunk
to the WAV, and releases the browser mix before normalization. A byte-for-byte integration check covers the
complete WAV payload, chunk boundaries and the short final chunk. The original whole-payload bridge remains
available for compatibility and profiling.

## Audio memory measurements

The checked-in JSON files record one run of a synthetic 48 kHz stereo tone with Linux and Node 26.13.0.
Each duration uses a fresh Chromium renderer. RSS is sampled from `/proc` independently of the browser main
thread every 10 ms. The figures below are additional peak RSS above the loaded video's baseline, in MiB.
They cover mixing, encoding, transfer and base64 decoding; they exclude WAV disk writes and normalization.

| Duration | Whole-payload renderer | Chunked renderer | Whole-payload Node | Chunked Node |
|---|---:|---:|---:|---:|
| 10 s | 35.5 | 25.7 | 6.1 | 5.0 |
| 30 s | 94.1 | 38.6 | 25.6 | 1.1 |
| 60 s | 186.5 | 64.8 | 54.9 | 36.1 |

The 60-second renderer increase fell about 65%. Transfer time was similar in this run (626 ms versus 628 ms).
RSS and elapsed time vary with V8 garbage collection, allocator reuse and Vite's worker activity; these are
observations, not fixed memory limits or a throughput guarantee. Renderer processes are isolated per duration,
while the Node process is reused. Ten-millisecond sampling can miss brief peaks. Non-Linux runs report no renderer
RSS measurement. Synthesis, the final floating-point mix, and decoded source audio still require memory proportional
to duration; the transport improvement does not make the whole audio engine stream its synthesis.

Reproduce with Node dependencies and Playwright's Chromium headless shell installed:

```sh
npm run profile:audio -- --legacy 10 30 60
npm run profile:audio -- 10 30 60
npm run test:integration
```

The integration suite additionally requires ffmpeg and ffprobe. Raw observations are in
[audio-whole-payload.json](audio-whole-payload.json) and [audio-chunked.json](audio-chunked.json).
