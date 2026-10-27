import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const markdownLink = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const fence = /^(```|~~~)[\s\S]*?^\1/gm;
const absolute = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

function pageUrl(file: string): string {
  const path = file.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
  return path ? `/${path}/` : "/";
}

function served(pathname: string): string {
  return /\.[a-z0-9]+$/i.test(pathname) || pathname.endsWith("/") ? pathname : `${pathname}/`;
}

export function unresolvedLinks(contentDir: string, pages: Iterable<string>): string[] {
  const routes = new Set([...pages].map((page) => served(`/${page.replace(/^\/|\/$/g, "")}`)));
  routes.add("/");
  const broken: string[] = [];
  const files = readdirSync(contentDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
    .map((entry) => relative(contentDir, join(entry.parentPath, entry.name)))
    .filter((file) => !/(^|\/)api\//.test(file))
    .toSorted();
  for (const file of files) {
    const page = pageUrl(file);
    const body = readFileSync(join(contentDir, file), "utf8").replace(fence, "");
    for (const [, target = ""] of body.matchAll(markdownLink)) {
      if (absolute.test(target)) continue;
      const { pathname } = new URL(target, `https://site.invalid${page}`);
      if (!routes.has(served(decodeURIComponent(pathname)))) broken.push(`${page} links ${target}`);
    }
  }
  return broken;
}
