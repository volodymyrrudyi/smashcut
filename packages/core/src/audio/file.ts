import { sound, type AudioClip, type SoundOptions } from "./mix";
import { makeStereo, type AudioSource, type Stereo } from "./synth";

/** Decoded PCM of an audio file, filled in by the runtime before the soundtrack is mixed. */
export interface DecodedAudio {
  sampleRate: number;
  channels: Stereo;
}

/** An audio source backed by a project file (a voiceover take, a recording, a licensed track). */
export interface FileSource extends AudioSource {
  /** Project path such as `/assets/vo.wav`, decoded by the CLI's ffmpeg. */
  src: string;
  /** Set by the runtime once the file is decoded; silent until then. */
  decoded?: DecodedAudio;
}

export const isFileSource = (source: AudioSource): source is FileSource =>
  typeof (source as FileSource).src === "string";

/**
 * A sound file in the project: `sound(audioFile(asset("vo.wav")), { at: 2 })`. Any format ffmpeg reads.
 * Its length is known once it's decoded; pass `knownDuration` when you know it up front.
 */
export function audioFile(src: string, knownDuration?: number): FileSource {
  const source: FileSource = {
    src,
    get duration() {
      return source.decoded ? source.decoded.channels[0].length / source.decoded.sampleRate : knownDuration;
    },
    render(sampleRate, seconds) {
      const out = makeStereo(Math.ceil(seconds * sampleRate));
      const decoded = source.decoded;
      if (!decoded) return out;
      const [l, r] = decoded.channels;
      const step = decoded.sampleRate / sampleRate;
      for (let i = 0; i < out[0].length; i++) {
        const pos = i * step;
        const k = Math.floor(pos);
        if (k + 1 >= l.length) break;
        const frac = pos - k;
        out[0][i] = l[k] + (l[k + 1] - l[k]) * frac;
        out[1][i] = r[k] + (r[k + 1] - r[k]) * frac;
      }
      return out;
    },
  };
  return source;
}

/** Every file-backed source in the soundtrack, so the runtime can decode them before mixing. */
export function fileSources(audio: readonly AudioClip[] = []): FileSource[] {
  return audio.map((clip) => clip.source).filter(isFileSource);
}

/** Place a sound file on the timeline; same as `sound(audioFile(src), opts)`. */
export const sample = (src: string, opts: SoundOptions = {}): AudioClip =>
  sound(audioFile(src), { label: "sample", ...opts });
