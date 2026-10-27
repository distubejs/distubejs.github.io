import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StarlightPlugin, StarlightUserConfig } from "@astrojs/starlight/types";
import type starlightLlmsTxt from "starlight-llms-txt";
import type { StarlightSidebarTopicsUserConfig, StarlightSidebarTopicsUserOptions } from "starlight-sidebar-topics";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";

type SidebarItem = NonNullable<StarlightUserConfig["sidebar"]>[number];
type CustomSet = NonNullable<NonNullable<Parameters<typeof starlightLlmsTxt>[0]>["customSets"]>[number];

interface Meta {
  name: string;
  version: string;
  description: string;
}

interface Major {
  slug: string;
  major: number;
  base: string;
  meta: Meta;
  entries: string[];
  api?: SidebarItem;
  plugin?: StarlightPlugin;
}

interface Product {
  id: string;
  label: string;
  description: string;
  slugs: string[];
  packagesLabel: string;
}

export interface SiteDocs {
  typeDocPlugins: StarlightPlugin[];
  topics: StarlightSidebarTopicsUserConfig;
  topicOptions: StarlightSidebarTopicsUserOptions;
  llmsSets: CustomSet[];
}

const majorDir = /^v\d+$/;
const archivedPath = /^\/[^/]+\/v\d+(\/|$)/;

const products = {
  distube: {
    id: "distube",
    label: "DisTube",
    description: "the DisTube client, its Discord adapters and official plugins",
    slugs: ["distube", "discordjs", "oceanic"],
    packagesLabel: "Adapters",
  },
  ytdl: {
    id: "ytdl-core",
    label: "ytdl-core",
    description: "the standalone YouTube downloader",
    slugs: ["ytdl-core"],
    packagesLabel: "Packages",
  },
} satisfies Record<string, Product>;

const publicSlugs = new Set(Object.values(products).flatMap((product) => product.slugs));
const nestedApiSlugs = new Set(
  Object.values(products)
    .filter((product) => product.slugs.length > 1)
    .flatMap((product) => product.slugs),
);

export function isArchived(pathname: string): boolean {
  return archivedPath.test(pathname);
}

function readMeta(file: string): Meta {
  const meta: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof meta !== "object" ||
    meta === null ||
    !("name" in meta && typeof meta.name === "string") ||
    !("version" in meta && typeof meta.version === "string") ||
    !("description" in meta && typeof meta.description === "string")
  ) {
    throw new Error(`${file} needs string name, version and description`);
  }
  return { name: meta.name, version: meta.version, description: meta.description };
}

function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function stageMajor(source: string, contentDir: string, slug: string, major: number, current: boolean): Major {
  const base = current ? slug : `${slug}/v${major}`;
  const dest = join(contentDir, base);
  const meta = readMeta(join(source, "meta.json"));
  mkdirSync(dest, { recursive: true });
  const readme = readFileSync(join(source, "index.md"), "utf8").replace(/^# .*\n+/, "");
  const frontmatter = `---\ntitle: ${JSON.stringify(meta.name)}\ndescription: ${JSON.stringify(meta.description)}\n---\n\n`;
  writeFileSync(join(dest, "index.md"), frontmatter + readme);

  const docs = join(source, "docs");
  const entries = existsSync(docs) ? readdirSync(docs).toSorted() : [];
  const reserved = entries.find((entry) => majorDir.test(entry.replace(/\.md$/, "")) || entry === "api");
  if (reserved) throw new Error(`${join(docs, reserved)} uses a reserved name`);
  if (existsSync(docs)) cpSync(docs, dest, { recursive: true });

  const result: Major = { slug, major, base, meta, entries };
  const apiJson = join(source, "api.json");
  if (existsSync(apiJson)) {
    const [typeDoc, group] = createStarlightTypeDocPlugin();
    result.api = group;
    result.plugin = typeDoc({
      entryPoints: [apiJson],
      output: `${base}/api`,
      sidebar: { label: nestedApiSlugs.has(slug) ? meta.name : "API reference", collapsed: true },
      typeDoc: {
        entryPointStrategy: "merge",
        interfacePropertiesFormat: "table",
        parametersFormat: "table",
        enumMembersFormat: "table",
        typeDeclarationFormat: "table",
        tableColumnSettings: { hideSources: true, hideModifiers: true },
      },
    });
  }
  return result;
}

function label(entry: string): string {
  const name = entry.replace(/\.md$/, "").replaceAll("-", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const directoryOrder = ["get-started", "guides", "recipes", "reference", "plugins", "extending"];

function directoryRank(entry: string): number {
  const index = directoryOrder.indexOf(entry);
  return index === -1 ? directoryOrder.length : index;
}

function docItems(major: Major): SidebarItem[] {
  const files = major.entries.filter((entry) => entry.endsWith(".md"));
  const directories = major.entries
    .filter((entry) => !entry.endsWith(".md"))
    .toSorted((a, b) => directoryRank(a) - directoryRank(b));
  return [
    ...directories.map((entry) => ({
      label: label(entry),
      items: [{ autogenerate: { directory: `${major.base}/${entry}` } }],
    })),
    ...files.map((entry) => `${major.base}/${entry.replace(/\.md$/, "")}`),
  ];
}

interface Staged {
  current: Major;
  archived: Major[];
}

function productItems(product: Product, [main, ...packages]: [Staged, ...Staged[]]): SidebarItem[] {
  const adapters =
    packages.length > 0
      ? [
          {
            label: product.packagesLabel,
            items: packages.map(({ current }) => ({ label: current.meta.name, link: `/${current.base}/` })),
          },
        ]
      : [];
  const apis = [main, ...packages].flatMap(({ current }) => (current.api ? [current.api] : []));
  return [
    { label: "Overview", link: `/${main.current.base}/` },
    ...docItems(main.current),
    ...adapters,
    ...(apis.length > 1 ? [{ label: "API reference", collapsed: true, items: apis }] : apis),
    ...[main, ...packages].flatMap(({ archived }) =>
      archived.map((major) => ({
        label: `${major.meta.name} v${major.major} (${major.meta.version})`,
        link: `/${major.base}/`,
      })),
    ),
  ];
}

function currentPaths(major: Major): string[] {
  const names = [...major.entries, ...(major.api ? ["api"] : [])];
  return [
    major.base,
    ...names.flatMap((name) => [`${major.base}/${name.replace(/\.md$/, "")}`, `${major.base}/${name}/**`]),
  ];
}

interface Topic {
  id: string;
  config: StarlightSidebarTopicsUserConfig[number];
  patterns: string[];
  set: CustomSet;
}

function productTopic(product: Product, bySlug: Map<string, Major[]>): Topic | undefined {
  const staged = product.slugs.flatMap((slug): Staged[] => {
    const [current, ...archived] = bySlug.get(slug) ?? [];
    return current ? [{ current, archived }] : [];
  });
  const [first, ...rest] = staged;
  if (!first) return undefined;
  return {
    id: product.id,
    config: {
      id: product.id,
      label: product.label,
      link: `/${first.current.base}/`,
      items: productItems(product, [first, ...rest]),
    },
    patterns: staged.flatMap(({ current }) => [`/${current.slug}`, `/${current.slug}/**`]),
    set: {
      label: product.label,
      description: product.description,
      paths: staged.flatMap(({ current }) => currentPaths(current)),
    },
  };
}

export function stageSnapshots(snapshotsDir: string, contentDir: string): SiteDocs {
  for (const dir of subdirs(contentDir)) rmSync(join(contentDir, dir), { recursive: true, force: true });
  const bySlug = new Map<string, Major[]>();
  for (const slug of existsSync(snapshotsDir) ? subdirs(snapshotsDir).toSorted() : []) {
    if (!publicSlugs.has(slug))
      throw new Error(`${join(snapshotsDir, slug)} is not a public DisTube or ytdl-core package`);
    const majors = subdirs(join(snapshotsDir, slug))
      .filter((dir) => majorDir.test(dir))
      .map((dir) => Number(dir.slice(1)))
      .toSorted((a, b) => b - a);
    bySlug.set(
      slug,
      majors.map((major, index) =>
        stageMajor(join(snapshotsDir, slug, `v${major}`), contentDir, slug, major, index === 0),
      ),
    );
  }

  const topics = [productTopic(products.distube, bySlug), productTopic(products.ytdl, bySlug)].filter(
    (topic) => topic !== undefined,
  );

  return {
    typeDocPlugins: [...bySlug.values()].flat().flatMap((major) => (major.plugin ? [major.plugin] : [])),
    topics: topics.map((topic) => topic.config),
    topicOptions: { topics: Object.fromEntries(topics.map((topic) => [topic.id, topic.patterns])) },
    llmsSets: topics.map((topic) => topic.set),
  };
}
