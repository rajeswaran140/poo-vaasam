# CI/CD — how deploys are gated

tamilagaval.com pushes directly to `master`, and AWS Amplify auto-builds `master`
on every push. Because the GitHub workflow and the Amplify build run **in
parallel**, a GitHub-only check cannot block a bad deploy on a direct push. So
the gate is two layers:

## Layer 1 — the real deploy gate (Amplify) ✅
`amplify.yml` runs the Jest suite in **preBuild**, before `next build`:

```
preBuild: … npm install … → npm test -- --ci → (only then) build
```

- A **failing test aborts preBuild** → the build never runs → **nothing deploys**.
- `tsc` and ESLint are already enforced *inside* `next build` (no `ignoreBuildErrors`
  / `ignoreDuringBuilds` in `next.config`), so type and lint errors already block
  the deploy. The new step closes the only gap: the test suite.

This works with the current direct-push-to-`master` workflow — no PR required.

## Layer 2 — fast feedback + PR gate (GitHub Actions)
`.github/workflows/ci.yml` runs **typecheck + lint + tests** on every push and PR.

- Gives a red/green signal on GitHub within ~2–3 min (independent of the ~6 min
  Amplify build), so you learn about a failure fast.
- Becomes a **required status check** for pull requests once branch protection is on.

### Recommended: turn on branch protection (one-time, in GitHub UI)
Settings → Branches → add a rule for `master`:
- ✅ Require status checks to pass before merging → select **CI / verify**
- (Optional) Require a pull request before merging — switches you from
  direct-push to a PR flow, where Layer 2 becomes a hard merge gate.

Until branch protection + PRs are enabled, **Layer 1 (Amplify) is what protects
prod** on direct pushes; Layer 2 is advisory signal.

## What runs
| Check | Command | Layer 1 (deploy) | Layer 2 (CI) |
|---|---|---|---|
| Typecheck | `tsc --noEmit` | ✅ via `next build` | ✅ explicit |
| Lint | `next lint` | ✅ via `next build` | ✅ explicit |
| Tests | `jest --ci` | ✅ **new** (preBuild) | ✅ |

## Cost / time
The suite is ~37s locally and adds the same to each Amplify build (well within
the build budget). If a test is ever environment-dependent and fails only in CI,
it will block deploys until fixed — that's the gate working; fix the test.
