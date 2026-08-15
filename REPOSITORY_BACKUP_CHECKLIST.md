# Repository Backup Checklist

- Run `npm run backup:readiness` and `npm run security:scan`.
- Confirm `git status --short`, `git diff --check`, and `git remote -v`.
- Confirm no APK, database, dump, backup, credential, key, biometric material, generated report, screenshot, browser/emulator artifact, or `node_modules` path is tracked.
- Review tracked files over 10 MB and package-lock integrity.
- After explicit authorization, create a private remote with least-privilege access, branch protection, MFA, recovery owners, and retention. Do not use a public repository.
- Push the candidate and tags only under repository authorization, then verify the remote commit by fresh clone into a disposable directory.

Restore rehearsal: clone the private remote into a new disposable path, verify the expected commit and signatures/policy, install from the lockfile, create local environment files from examples, run migrations into an empty loopback database, seed synthetic data, run both final gates, and compare the APK hash. Never restore a database dump from source control.

Current status: no remote is configured. This is a Critical operational continuity risk, not a software defect. No remote was created because explicit authorization is absent.
