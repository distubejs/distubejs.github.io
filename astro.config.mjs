import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightSidebarTopics from "starlight-sidebar-topics";
import { isArchived, stageSnapshots } from "./src/snapshots.ts";

const site = "https://distube.js.org";
const docs = stageSnapshots(
  process.env.DOCS_SNAPSHOTS ?? "snapshots",
  new URL("./src/content/docs/", import.meta.url).pathname,
);

export default defineConfig({
  site,
  integrations: [
    sitemap({ filter: (page) => !isArchived(new URL(page).pathname) }),
    starlight({
      title: "DisTube",
      description: "Documentation for DisTube, its official plugins and ytdl-core.",
      customCss: ["./src/styles/theme.css"],
      components: {
        Hero: "./src/components/Hero.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
        Footer: "./src/components/Footer.astro",
      },
      routeMiddleware: "./src/routeData.ts",
      head: [
        { tag: "link", attrs: { rel: "expect", href: "#_top", blocking: "render" } },
        ...["figtree-latin", "league-spartan-latin"].map((font) => ({
          tag: "link",
          attrs: { rel: "preload", href: `/fonts/${font}.woff2`, as: "font", type: "font/woff2", crossorigin: true },
        })),
        { tag: "meta", attrs: { property: "og:image", content: `${site}/og.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${site}/og.png` } },
      ],
      plugins: [
        ...(docs.topics.length > 0 ? [starlightSidebarTopics(docs.topics, docs.topicOptions)] : []),
        ...docs.typeDocPlugins,
        starlightLlmsTxt({
          projectName: "DisTube",
          customSets: docs.llmsSets,
          exclude: ["*/v+([0-9])", "*/v+([0-9])/**"],
        }),
      ],
    }),
  ],
});
