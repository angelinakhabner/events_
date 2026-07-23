# Project conventions for Claude

## Branch & release workflow (dev → main)

- The repo's default branch `claude/epic-goldberg-qj4EC` acts as **main /
  production**. The GitHub Pages root site and the Railway backend follow it.
- **All updates land on the `dev` branch first.** Develop on a feature branch,
  run the checks below, and merge/PR into `dev` — never directly into the
  default branch.
- Every push to `dev` deploys a **password-gated preview** at
  `https://<owner>.github.io/<repo>/dev/` (see `.github/workflows/deploy-frontend.yml`
  and `frontend/src/components/DevGate.tsx`). The owner reviews changes there.
- Only after the dev preview is verified by the owner is `dev` promoted to the
  default branch via a PR (`dev` → `claude/epic-goldberg-qj4EC`), which
  redeploys the production site at the Pages root.
- Keep `dev` in sync after a promotion: fast-forward it to the default branch.

## Required checks before pushing

```bash
npm run typecheck
npm run lint
npm test
```

CI (`.github/workflows/ci.yml`) runs the same suite on PRs and on pushes to
`dev` and the default branch.
