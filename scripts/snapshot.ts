import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Manifest {
  name: string;
  version: string;
  description: string;
  private: boolean;
  exports: unknown;
}

const typedocBin = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/.bin/typedoc");

const conditionRank = (key: string): number =>
  key === "types" ? 0 : key === "import" || key === "default" ? 1 : key === "require" ? 3 : 2;

function typesTarget(node: unknown, underTypes = false): string | undefined {
  if (typeof node === "string") return underTypes ? node : undefined;
  if (typeof node !== "object" || node === null) return undefined;
  const entries = Object.entries(node).toSorted(([a], [b]) => conditionRank(a) - conditionRank(b));
  for (const [key, value] of entries) {
    const found = typesTarget(value, underTypes || key === "types");
    if (found) return found;
  }
  return undefined;
}

function typesTargets(exports: unknown): string[] {
  const subpaths =
    typeof exports === "object" && exports !== null && Object.keys(exports).every((key) => key.startsWith("."))
      ? Object.values(exports)
      : [exports];
  return subpaths.flatMap((subpath) => typesTarget(subpath) ?? []);
}

async function readManifest(file: string): Promise<Manifest> {
  const manifest: unknown = JSON.parse(await readFile(file, "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest && typeof manifest.name === "string") ||
    !("version" in manifest && typeof manifest.version === "string")
  ) {
    throw new Error(`${file} needs string name and version`);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    description: "description" in manifest && typeof manifest.description === "string" ? manifest.description : "",
    private: "private" in manifest && manifest.private === true,
    exports: "exports" in manifest ? manifest.exports : undefined,
  };
}

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`typedoc exited ${code}\n${out}${err}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const docsFlag = args.indexOf("--docs");
  const docsArg = docsFlag === -1 ? undefined : args.splice(docsFlag, 2)[1];
  const [packageArg, snapshotsArg] = args;
  if (!packageArg || !snapshotsArg || (docsFlag !== -1 && !docsArg)) {
    throw new Error("usage: snapshot.ts <package dir> <snapshots dir> [--docs <dir>]");
  }
  const packageDir = resolve(packageArg);
  const snapshotsDir = resolve(snapshotsArg);
  const docsDir = docsArg ? resolve(docsArg) : undefined;

  const manifest = await readManifest(join(packageDir, "package.json"));
  if (manifest.private) throw new Error(`${manifest.name} is private`);
  if (manifest.version.includes("-")) throw new Error(`${manifest.name}@${manifest.version} is a prerelease`);

  const entryPoints = typesTargets(manifest.exports).map((target) => resolve(packageDir, target));
  if (entryPoints.length === 0) throw new Error(`${manifest.name} has no types targets in exports`);

  const docs = docsDir ? await markdownFiles(docsDir) : [];
  if (docs.includes("index.md")) throw new Error("docs must not contain a root index.md");

  const slug = manifest.name.replace(/^@distube\//, "");
  const major = manifest.version.split(".")[0];
  const target = join(snapshotsDir, slug, `v${major}`);

  await mkdir(snapshotsDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "snapshot-"));
  try {
    const staged = join(work, "staged");
    await mkdir(staged);
    const tsconfig = join(work, "tsconfig.json");
    await writeFile(tsconfig, JSON.stringify({ files: entryPoints }));
    await run([
      typedocBin,
      "--tsconfig",
      tsconfig,
      "--entryPoints",
      ...entryPoints,
      "--json",
      join(staged, "api.json"),
      "--disableSources",
      "--skipErrorChecking",
      "--logLevel",
      "Warn",
    ]);
    await cp(join(packageDir, "README.md"), join(staged, "index.md"));
    for (const file of docs) {
      await mkdir(dirname(join(staged, "docs", file)), { recursive: true });
      await cp(join(docsDir ?? "", file), join(staged, "docs", file));
    }
    const { name, version, description } = manifest;
    await writeFile(join(staged, "meta.json"), `${JSON.stringify({ name, version, description }, null, 2)}\n`);

    await mkdir(dirname(target), { recursive: true });
    const incoming = `${target}.incoming`;
    await rm(incoming, { recursive: true, force: true });
    await cp(staged, incoming, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(incoming, target);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(relative(process.cwd(), target) || target);
}

await main().catch((error: unknown) => {
  console.error(`snapshot: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
