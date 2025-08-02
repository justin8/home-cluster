# Git Workflow Rules

## Commit and Push
When making changes and a feature is complete:
1. First run `git status` to show what has changed
2. Then do a git commit and push in one command:

```bash
git status
```

```bash
git add . && git commit -m "message" && git push
```

## Commit Message Format
Use conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `chore:` for maintenance tasks
- `ci:` for CI/CD changes

## Guidelines
- Keep changes focused and atomic
- Test changes before committing
- Update documentation when adding new features
- Follow existing code patterns and conventions
