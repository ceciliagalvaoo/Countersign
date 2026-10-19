# Documentation site

Built with [Docusaurus](https://docusaurus.io/).

```bash
npm ci        # install
npm start     # local dev server at http://localhost:3000
npm run build # static build into ./build
```

## Deployment

Deployed automatically to GitHub Pages by `.github/workflows/deploy-doc.yaml` on every push to `main` that touches `docs/`.
The site URL and base path are derived from the repository name (`GITHUB_REPOSITORY`), so no config change is needed when the repo is renamed or forked.

One-time setup in the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
