// @ts-check
// Countersign documentation site (Docusaurus). The Markdown sources in docs/docs are the same content, readable in the repository.

import { themes as prismThemes } from "prism-react-renderer";

// GitHub Actions sets GITHUB_REPOSITORY ("owner/repo"), so the GitHub Pages URL
// is derived from whichever repository builds the site. Locally it falls back to "/".
const [githubOwner, githubRepo] = (process.env.GITHUB_REPOSITORY || "").split("/");
const githubUrl = githubOwner ? `https://github.com/${githubOwner}/${githubRepo}` : "https://github.com";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Countersign",
  tagline: "Sign only what you can read.",
  favicon: "img/countersign.svg",

  url: githubOwner ? `https://${githubOwner.toLowerCase()}.github.io` : "http://localhost:3000",
  baseUrl: githubRepo ? `/${githubRepo}/` : "/",

  organizationName: githubOwner,
  projectName: githubRepo,

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },

  themes: ["@docusaurus/theme-mermaid"],

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: "./sidebars.js",
          routeBasePath: "/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: "img/countersign.svg",
      colorMode: {
        defaultMode: "dark",
        disableSwitch: true,
        respectPrefersColorScheme: false,
      },
      mermaid: {
        theme: { light: "neutral", dark: "dark" },
      },
      navbar: {
        title: "Countersign",
        logo: {
          alt: "Countersign",
          src: "img/countersign.svg",
        },
        items: [
          {
            href: githubUrl,
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        copyright:
          "Countersign. Licensed under GPL-3.0-only. Test assets on the Stellar test network; no monetary value. Our contracts are not audited.",
      },
      prism: {
        theme: prismThemes.vsDark,
        darkTheme: prismThemes.vsDark,
      },
    }),
};

export default config;
