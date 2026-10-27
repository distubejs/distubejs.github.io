import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unresolvedLinks } from "../src/links.ts";

async function withContent(files: Record<string, string>, run: (dir: string) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "links-test-"));
  try {
    for (const [file, body] of Object.entries(files)) {
      await mkdir(join(dir, file, ".."), { recursive: true });
      await writeFile(join(dir, file), body);
    }
    run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const pages = ["distube/", "distube/plugins/", "distube/plugins/youtube/", "distube/get-started/quick-start/"];

test("a plugin page linking past its depth names the page and the target", async () => {
  await withContent(
    {
      "distube/index.md": "# DisTube\n",
      "distube/plugins/youtube.md": "See [start](../get-started/quick-start/).\n",
    },
    (dir) => {
      expect(unresolvedLinks(dir, pages)).toEqual(["/distube/plugins/youtube/ links ../get-started/quick-start/"]);
    },
  );
});

test("served relative links, absolute URLs, fragments, images and code samples are not reported", async () => {
  await withContent(
    {
      "distube/plugins/youtube.md": [
        "[ok](../../get-started/quick-start/) [api](../../api/readme/#top) [site](https://example.com/x)",
        "[frag](#install) ![shot](./missing.png)",
        "```md\n[sample](./nowhere/)\n```",
      ].join("\n"),
      "distube/api/readme.md": "[generated](../nope/)\n",
    },
    (dir) => {
      expect(unresolvedLinks(dir, [...pages, "distube/api/readme/"])).toEqual([]);
    },
  );
});
