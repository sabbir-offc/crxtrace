import { defineCollection } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Declared even though the site is English-only: without it Starlight warns
  // about a missing collection on every build.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
