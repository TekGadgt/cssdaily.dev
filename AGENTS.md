# Repository Working Agreements

## Branch safety

- Before any repository mutation, inspect the current branch and worktree.
- If already on the relevant feature branch, continue there.
- If on `main` or `master`, create and switch to a descriptively named feature branch before editing files, installing dependencies, running mutating code generation, or committing. Modify the default branch only when the user explicitly requests that exception.
- If the worktree is clean but the current branch is unrelated, return to an updated default branch and create the feature branch from there.
- If uncommitted work is unexpectedly present on the default branch or an unrelated branch, preserve it: create a branch from the current HEAD or stop for direction. Never stash, reset, discard, or transplant it implicitly.
- Re-check the branch immediately before the first edit and before committing.
