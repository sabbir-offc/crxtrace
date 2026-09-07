// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://crxtrace.dev",
  integrations: [
    starlight({
      title: "CrxTrace",
      description:
        "MV3-aware error tracking for Chrome extensions. Events survive service worker death, content script errors group by host, and track() names the task that died.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/sabbir-offc/crxtrace",
        },
        {
          icon: "npm",
          label: "npm",
          href: "https://www.npmjs.com/package/crxtrace",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/sabbir-offc/crxtrace/edit/main/docs/",
      },
      lastUpdated: true,
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Migrating from Sentry", slug: "migrating-from-sentry" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Service worker deaths", slug: "guides/worker-deaths" },
            { label: "Content scripts", slug: "guides/content-scripts" },
            { label: "MV3 error categories", slug: "guides/error-categories" },
            { label: "Privacy and redaction", slug: "guides/privacy" },
            { label: "Filtering events", slug: "guides/filtering" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "API", slug: "reference/api" },
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Envelope format", slug: "reference/envelope" },
            { label: "Self-hosting", slug: "reference/self-hosting" },
          ],
        },
      ],
    }),
  ],
});
