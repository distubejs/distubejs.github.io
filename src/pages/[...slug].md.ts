import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from "astro";
import { getCollection } from "astro:content";

export const getStaticPaths = (async () =>
  (await getCollection("docs")).map((entry) => ({
    params: { slug: entry.id },
    props: { body: entry.body ?? "" },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) =>
  new Response(props.body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
