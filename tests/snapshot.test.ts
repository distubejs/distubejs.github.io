import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/snapshot.ts");
const fixture = join(import.meta.dir, "fixtures/snapshot-package");

let work: string;
let pkg: string;
let snapshots: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "snapshot-test-"));
  pkg = join(work, "pkg");
  snapshots = join(work, "snapshots");
  await cp(fixture, pkg, { recursive: true });
});

afterEach(() => rm(work, { recursive: true, force: true }));

async function snapshot(...extra: string[]): Promise<{ code: number }> {
  const proc = Bun.spawn(["bun", script, pkg, snapshots, ...extra], { stdout: "pipe", stderr: "pipe" });
  await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited };
}

async function patchManifest(patch: Record<string, unknown>): Promise<void> {
  const path = join(pkg, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...manifest, ...patch }));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("snapshot.ts", () => {
  test("writes api.json for one types target per exports subpath, meta, index and docs", async () => {
    expect((await snapshot("--docs", join(pkg, "docs"))).code).toBe(0);
    const dir = join(snapshots, "fixture", "v2");
    const api = JSON.parse(await readFile(join(dir, "api.json"), "utf8")) as {
      children: { name: string; children?: { name: string }[] }[];
    };
    const modules = Object.fromEntries(api.children.map((m) => [m.name, (m.children ?? []).map((c) => c.name)]));
    expect(modules).toEqual({ index: ["mainEntry"], extra: ["ExtraEntry"] });
    expect(JSON.parse(await readFile(join(dir, "meta.json"), "utf8"))).toEqual({
      name: "@distube/fixture",
      version: "2.1.0",
      description: "Fixture package",
    });
    expect(await readFile(join(dir, "index.md"), "utf8")).toBe("# Fixture\n\nReadme body.\n");
    expect(await readFile(join(dir, "docs/guides/intro.md"), "utf8")).toContain("title: Intro");
  });

  test("a dual-format subpath yields one module, preferring import over require", async () => {
    await cp(join(pkg, "dist/index.d.ts"), join(pkg, "dist/index.d.cts"));
    await patchManifest({
      exports: {
        ".": { types: { require: "./dist/index.d.cts", default: "./dist/index.d.ts" }, default: "./dist/index.js" },
        "./extra": { require: { types: "./dist/extra.d.ts" }, import: { types: "./dist/extra.d.ts" } },
      },
    });
    expect((await snapshot()).code).toBe(0);
    const api = JSON.parse(await readFile(join(snapshots, "fixture", "v2", "api.json"), "utf8")) as {
      children: { name: string }[];
    };
    expect(api.children.map((m) => m.name).toSorted()).toEqual(["extra", "index"]);
  });

  test("a second run of the same major replaces the directory and keeps other majors", async () => {
    expect((await snapshot()).code).toBe(0);
    const dir = join(snapshots, "fixture", "v2");
    await writeFile(join(dir, "stale.txt"), "old");
    const other = join(snapshots, "fixture", "v1");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "meta.json"), "{}");
    expect((await snapshot()).code).toBe(0);
    expect(await exists(join(dir, "stale.txt"))).toBe(false);
    expect(await exists(join(dir, "api.json"))).toBe(true);
    expect(await exists(join(other, "meta.json"))).toBe(true);
  });

  test.each([
    ["private", { private: true }],
    ["prerelease", { version: "3.0.0-beta.1" }],
  ])("a %s manifest exits non-zero and writes nothing", async (_label, patch) => {
    await patchManifest(patch);
    expect((await snapshot()).code).not.toBe(0);
    expect(await exists(snapshots)).toBe(false);
  });

  test("a root index.md in --docs is rejected and writes nothing", async () => {
    await writeFile(join(pkg, "docs/index.md"), "# Root\n");
    expect((await snapshot("--docs", join(pkg, "docs"))).code).not.toBe(0);
    expect(await exists(snapshots)).toBe(false);
  });
});
