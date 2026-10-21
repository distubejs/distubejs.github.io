import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { isArchived } from "./snapshots.ts";

export const onRequest = defineRouteMiddleware((context) => {
  if (!isArchived(context.url.pathname)) return;
  context.locals.starlightRoute.head.push({ tag: "meta", attrs: { name: "robots", content: "noindex" }, content: "" });
});
