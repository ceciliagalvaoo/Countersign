// @ts-check
// Countersign documentation site (Docusaurus), painted Ink on Cream like the app. The Markdown sources in docs/docs are the same content, readable in the repository.

import { themes as prismThemes } from "prism-react-renderer";

// GitHub Actions sets GITHUB_REPOSITORY ("owner/repo"), so the GitHub Pages URL
// is derived from whichever repository builds the site. Locally it falls back to "/".
const [githubOwner, githubRepo] = (process.env.GITHUB_REPOSITORY || "").split("/");
const githubUrl = githubOwner ? `https://github.com/${githubOwner}/${githubRepo}` : "https://github.com";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Countersign",
  tagline: "Sign only what you can read.",
  favicon: "img/favicon.svg",

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
      // The product is Ink on Cream; the documentation follows it rather than a default theme.
      colorMode: {
        defaultMode: "light",
        disableSwitch: false,
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
            href: "https://countersign-web-rt1a.onrender.com",
            label: "Live demo",
            position: "right",
          },
          {
            href: githubUrl,
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "light",
        links: [
          {
            title: "Read",
            items: [
              { label: "Overview", to: "/" },
              { label: "How it works", to: "/how-it-works" },
              { label: "Limitations", to: "/limitations" },
            ],
          },
          {
            title: "Use",
            items: [
              { label: "Live demo", href: "https://countersign-web-rt1a.onrender.com" },
              { label: "Walkthrough", to: "/live-demo" },
              { label: "Run it yourself", to: "/run-it-yourself" },
            ],
          },
          {
            title: "Source",
            items: [{ label: "GitHub", href: githubUrl }],
          },
        ],
        copyright:
          "Countersign. Licensed under GPL-3.0-only. Test assets on the Stellar test network; no monetary value. Our contracts are not audited.",
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
