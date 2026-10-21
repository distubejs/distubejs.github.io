import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageSnapshots } from "../src/snapshots.ts";

const root = join(import.meta.dir, "..");
const fixtures = join(import.meta.dir, "fixtures/snapshots");

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("site built from fixture snapshots", () => {
  let dist = "";
  const read = (path: string) => readFile(join(dist, path), "utf8");

  beforeAll(async () => {
    // Astro moves build assets with rename(), so outDir must share the repository's filesystem.
    const cache = join(root, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    dist = await mkdtemp(join(cache, "site-test-"));
    const proc = Bun.spawn([join(root, "node_modules/.bin/astro"), "build", "--outDir", dist], {
      cwd: root,
      env: { ...process.env, DOCS_SNAPSHOTS: fixtures },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`astro build exited ${code}\n${out}${err}`);
  }, 300_000);

  afterAll(() => rm(dist, { recursive: true, force: true }));

  test("robots.txt allows every crawler and names the sitemap index", async () => {
    const robots = await read("robots.txt");
    expect(robots).toContain("User-agent: *\nAllow: /");
    expect(robots).toContain("Sitemap: https://distube.js.org/sitemap-index.xml");
    expect(await exists(join(dist, "sitemap-index.xml"))).toBe(true);
  });

  test("the sitemap lists current pages and no archived major", async () => {
    const sitemap = await read("sitemap-0.xml");
    expect(sitemap).toContain("<loc>https://distube.js.org/distube/guides/events/</loc>");
    expect(sitemap).toContain("<loc>https://distube.js.org/ytdl-core/guides/formats/</loc>");
    expect(sitemap).not.toContain("/v6/");
  });

  test("archived pages carry noindex and current pages carry a distube.js.org canonical", async () => {
    const noindex = '<meta name="robots" content="noindex"';
    expect(await read("distube/v6/guides/events/index.html")).toContain(noindex);
    const current = await read("distube/guides/events/index.html");
    expect(current).not.toContain(noindex);
    expect(current).toContain('<link rel="canonical" href="https://distube.js.org/distube/guides/events/"');
  });

  test("llms.txt links one set per product and only llms-full.txt includes archived majors", async () => {
    const llms = await read("llms.txt");
    for (const set of ["distube", "distube-plugins", "ytdl-core"]) {
      expect(llms).toContain(`(https://distube.js.org/_llms-txt/${set}.txt)`);
    }
    expect(llms).not.toContain("/v6/");
    for (const file of ["llms-small.txt", "_llms-txt/distube.txt", "_llms-txt/distube-plugins.txt"]) {
      expect(await read(file)).not.toContain("major-6");
    }
    const ytdl = await read("_llms-txt/ytdl-core.txt");
    expect(ytdl).toContain("ytdl-formats");
    expect(ytdl).not.toContain("major-7");
  });

  test("a page's .md twin is its Markdown source body", async () => {
    const source = await readFile(join(fixtures, "distube/v7/docs/guides/events.md"), "utf8");
    const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    expect(await read("distube/guides/events.md")).toBe(body);
  });

  test("the distube API reference documents both entry points", async () => {
    expect(await exists(join(dist, "distube/api/index/classes/distube/index.html"))).toBe(true);
    expect(await exists(join(dist, "distube/api/integrations/interfaces/sourceplugin/index.html"))).toBe(true);
  });

  test("the landing hero links DisTube, DisTube Plugins and ytdl-core in that order", async () => {
    const products = (await read("index.html")).match(/<ol[^>]*yt-products[\s\S]*?<\/ol>/)?.[0] ?? "";
    const links = [...products.matchAll(/<a href="([^"]+)"[^>]*><strong[^>]*>([^<]+)<\/strong>/g)].map((m) => [
      m[2],
      m[1],
    ]);
    expect(links).toEqual([
      ["DisTube", "/distube/"],
      ["DisTube Plugins", "/distube/plugins/"],
      ["ytdl-core", "/ytdl-core/"],
    ]);
  });

  test("plugin pages are DisTube guides with no section of their own", async () => {
    expect(await read("distube/plugins/youtube/index.html")).toContain("major-7-youtube");
    expect(await exists(join(dist, "youtube"))).toBe(false);
  });

  test("a package overview renders its title once above the README", async () => {
    const overview = await read("distube/index.html");
    expect(overview.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(overview).toContain("The v7 readme.");
  });
});

test("staging rejects a snapshot of a private package", async () => {
  const work = await mkdtemp(join(tmpdir(), "site-stage-"));
  try {
    await mkdir(join(work, "snapshots/voice-core/v1"), { recursive: true });
    await mkdir(join(work, "content"));
    expect(() => stageSnapshots(join(work, "snapshots"), join(work, "content"))).toThrow(
      "is not a public DisTube or ytdl-core package",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
