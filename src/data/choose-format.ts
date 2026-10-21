import type { MockFormat } from "./big-buck-bunny.ts";

export const Quality = {
  Highest: "highest",
  Lowest: "lowest",
  HighestAudio: "highestaudio",
  LowestAudio: "lowestaudio",
  HighestVideo: "highestvideo",
  LowestVideo: "lowestvideo",
} as const;

export type Quality = (typeof Quality)[keyof typeof Quality];

export interface Criteria {
  readonly hasAudio?: boolean;
  readonly hasVideo?: boolean;
}

type Rank = (format: MockFormat) => number;

const VIDEO_ENCODINGS = ["mp4v", "avc1", "Sorenson H.283", "MPEG-4 Visual", "VP8", "VP9", "vp09", "av01", "H.264"];
const AUDIO_ENCODINGS = ["mp4a", "mp3", "vorbis", "aac", "opus", "flac"];

const qualityHeight: Rank = (format) => Number.parseInt(format.qualityLabel ?? "", 10) || 0;
const videoBitrate: Rank = (format) => (format.hasVideo ? (format.bitrate ?? 0) : 0);
const audioBitrate: Rank = (format) => format.audioBitrate ?? 0;
const videoEncoding: Rank = (format) => VIDEO_ENCODINGS.findIndex((encoding) => format.codecs.includes(encoding));
const audioEncoding: Rank = (format) => AUDIO_ENCODINGS.findIndex((encoding) => format.codecs.includes(encoding));

function compare(ranks: readonly Rank[]) {
  return (a: MockFormat, b: MockFormat): number => {
    for (const rank of ranks) {
      const difference = rank(b) - rank(a);
      if (difference !== 0) return difference;
    }
    return 0;
  };
}

const byVideo = compare([qualityHeight, videoBitrate, videoEncoding]);
const byAudio = compare([audioBitrate, audioEncoding]);
const byOverall = compare([
  (format) => Number(format.contentLength !== undefined && format.contentLength > 0),
  (format) => Number(format.hasVideo && format.hasAudio),
  (format) => Number(format.hasVideo),
  qualityHeight,
  videoBitrate,
  audioBitrate,
  videoEncoding,
  audioEncoding,
]);

function best(sorted: readonly MockFormat[], equal: (a: MockFormat, b: MockFormat) => number, tiebreak: Rank) {
  const top = sorted[0];
  return top && sorted.filter((format) => equal(top, format) === 0).toSorted((a, b) => tiebreak(a) - tiebreak(b))[0];
}

function pick(candidates: readonly MockFormat[], quality: Quality): MockFormat | undefined {
  switch (quality) {
    case "highest":
      return candidates.toSorted(byOverall)[0];
    case "lowest":
      return candidates.toSorted(byOverall).at(-1);
    case "highestaudio":
      return best(candidates.filter((format) => format.hasAudio).toSorted(byAudio), byAudio, qualityHeight);
    case "lowestaudio":
      return candidates
        .filter((format) => format.hasAudio)
        .toSorted(byAudio)
        .at(-1);
    case "highestvideo":
      return best(candidates.filter((format) => format.hasVideo).toSorted(byVideo), byVideo, audioBitrate);
    case "lowestvideo":
      return candidates
        .filter((format) => format.hasVideo)
        .toSorted(byVideo)
        .at(-1);
  }
}

export function chooseFormat(
  formats: readonly MockFormat[],
  quality: Quality,
  filter: Criteria = {},
): MockFormat | undefined {
  const matching = formats.filter(
    (format) =>
      (filter.hasAudio === undefined || format.hasAudio === filter.hasAudio) &&
      (filter.hasVideo === undefined || format.hasVideo === filter.hasVideo),
  );
  const originals = matching.filter((format) => !format.isDrc);
  return pick(originals.length > 0 ? originals : matching, quality);
}
