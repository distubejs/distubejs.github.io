import { getCollection } from "astro:content";

export async function servedPages(): Promise<Set<string>> {
  const entries = await getCollection("docs");
  return new Set(entries.map((entry) => `/${entry.id.replace(/(^|\/)index$/, "")}/`));
}
