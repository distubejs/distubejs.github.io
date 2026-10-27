import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

interface Build {
  code: number;
  log: string;
  dist: string;
}

async function build(snapshots: string): Promise<Build> {
  // Astro moves build assets with rename(), so outDir must share the repository's filesystem.
  const cache = join(root, "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const dist = await mkdtemp(join(cache, "site-test-"));
  const proc = Bun.spawn([join(root, "node_modules/.bin/astro"), "build", "--outDir", dist], {
    cwd: root,
    env: { ...process.env, DOCS_SNAPSHOTS: snapshots },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, log: out + err, dist };
}

async function snapshotsWith(copy: (from: string, to: string) => Promise<void>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "site-snapshots-"));
  await copy(fixtures, dir);
  return dir;
}

describe("site built from fixture snapshots", () => {
  let dist = "";
  const read = (path: string) => readFile(join(dist, path), "utf8");

  beforeAll(async () => {
    const result = await build(fixtures);
    dist = result.dist;
    if (result.code !== 0) throw new Error(`astro build exited ${result.code}\n${result.log}`);
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
    for (const set of ["distube", "ytdl-core"]) {
      expect(llms).toContain(`(https://distube.js.org/_llms-txt/${set}.txt)`);
    }
    expect(llms).not.toContain("/v6/");
    expect(await read("llms-small.txt")).not.toContain("major-6");
    const distube = await read("_llms-txt/distube.txt");
    expect(distube).toContain("major-7-youtube");
    expect(distube).not.toContain("major-6");
    const ytdl = await read("_llms-txt/ytdl-core.txt");
    expect(ytdl).toContain("ytdl-formats");
    expect(ytdl).not.toContain("major-7");
  });

  test("a page's .md twin is its Markdown source body", async () => {
    const source = await readFile(join(fixtures, "distube/v7/docs/guides/events.md"), "utf8");
    const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    expect(await read("distube/guides/events.md")).toBe(body);
  });

  test("the DisTube sidebar lists docs sections in task order, then adapters, then API reference", async () => {
    const page = await read("distube/guides/events/index.html");
    const sidebar = page.slice(page.indexOf('<ul class="top-level'), page.indexOf("</sl-sidebar-state-persist>"));
    const labels = [
      ">Overview<",
      ">Guides<",
      ">Plugins<",
      ">Extending<",
      ">Adapters<",
      ">@distube/discordjs<",
      ">API reference<",
      ">distube<",
      ">@distube/discordjs<",
    ];
    let from = 0;
    for (const label of labels) {
      from = sidebar.indexOf(label, from);
      expect(from, label).toBeGreaterThanOrEqual(0);
    }
    expect(page).not.toContain("Symbol(");
  });

  test("the distube API reference documents both entry points", async () => {
    expect(await exists(join(dist, "distube/api/index/classes/distube/index.html"))).toBe(true);
    expect(await exists(join(dist, "distube/api/integrations/interfaces/sourceplugin/index.html"))).toBe(true);
  });

  test("the landing page shows the DisTube hero, then the ytdl-core hero with a format picker", async () => {
    const page = await read("index.html");
    const distube = page.indexOf('href="/distube/"');
    const ytdl = page.indexOf('href="/ytdl-core/guides/getting-started/"');
    expect(distube).toBeGreaterThan(-1);
    expect(ytdl).toBeGreaterThan(distube);
    expect(page.indexOf('class="yt-picker')).toBeGreaterThan(ytdl);
  });

  test("the landing page links only pages the site serves", async () => {
    const page = await read("index.html");
    const hrefs = [...page.matchAll(/href="(\/(?:distube|ytdl-core)\/[^"#]*)"/g)].map((m) => m[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(await exists(join(dist, href, "index.html")), href).toBe(true);
  });

  test("the format picker marks the format chooseFormat picks for every quality and filter", async () => {
    const page = await read("index.html");
    const picks = [...page.matchAll(/data-picks="([^"]+)"/g)].flatMap((m) => m[1]?.split(" ") ?? []);
    expect(picks).toContain("highest:0");
    expect(picks).toContain("highestaudio:2");
    expect(new Set(picks).size).toBe(picks.length);
  });

  test("plugin pages are DisTube guides with no section or topic of their own", async () => {
    const page = await read("distube/plugins/youtube/index.html");
    expect(page).toContain("major-7-youtube");
    expect(page).toMatch(/starlight-sidebar-topics-current[^>]*><div[^>]*>DisTube</);
    expect(page).not.toContain("DisTube Plugins</div>");
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

describe("landing page on other snapshot sets", () => {
  const cleanup: string[] = [];
  afterAll(() => Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true }))));

  async function buildWith(copy: (from: string, to: string) => Promise<void>): Promise<Build> {
    const snapshots = await snapshotsWith(copy);
    const result = await build(snapshots);
    cleanup.push(snapshots, result.dist);
    return result;
  }

  test("a site with only ytdl-core snapshots has no DisTube hero or footer link", async () => {
    const result = await buildWith((from, to) =>
      cp(join(from, "ytdl-core"), join(to, "ytdl-core"), { recursive: true }),
    );
    expect(result.code).toBe(0);
    const page = await readFile(join(result.dist, "index.html"), "utf8");
    expect(page).not.toContain('href="/distube/');
    expect(page).toContain('href="/ytdl-core/guides/getting-started/"');
  }, 300_000);

  test("a DisTube snapshot without the guides the hero names links to none of them", async () => {
    const result = await buildWith((from, to) =>
      cp(join(from, "distube/v6"), join(to, "distube/v6"), { recursive: true }),
    );
    expect(result.code).toBe(0);
    const page = await readFile(join(result.dist, "index.html"), "utf8");
    expect(page).toContain('href="/distube/"');
    expect(page).not.toContain('href="/distube/get-started/quick-start/"');
  }, 300_000);
});
