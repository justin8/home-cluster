# Technology Stack

## Core Technologies

- **Language**: TypeScript
- **IaC Framework**: Pulumi v3
- **Kubernetes Distribution**: Talos Linux v1.11.2
- **Kubernetes Version**: v1.34.1
- **Package Manager**: npm
- **Development Environment**: Nix shell (all tools managed automatically)

## CLI Tools (via Nix)

- `talosctl` - Talos cluster management
- `talhelper` - Talos configuration helper (primary tool for multi-node operations)
- `kubectl` - Kubernetes CLI
- `kubectl-cnpg` - CloudNativePG plugin
- `helm` - Kubernetes package manager
- `pulumi` - Infrastructure deployment
- `sops` - Secret encryption
- `age` - Encryption tool
- `k9s` - Kubernetes TUI
- `prettier` - Code formatting

## Common Commands

### Environment Setup

Environment is automatically managed via direnv (no manual setup needed). It automatically:

- Installs all CLI tools
- Sets environment variables (KUBECONFIG, TALOSCONFIG, SOPS_AGE_KEY_FILE)
- Generates Talos configs via direnv
- Configures Pulumi
- Installs npm dependencies
- Sets up git hooks

### Pulumi Operations

```bash
cd pulumi

# Preview infrastructure changes
pulumi preview

# Deploy infrastructure changes
pulumi up

# Destroy infrastructure
pulumi destroy

# View stack outputs
pulumi stack output

# Set configuration values
pulumi config set <key> <value>
pulumi config set --secret <key> <value>  # For sensitive values

# Format code
npm run format
npm run format:check
```

### Talos Operations

**Primary Tool: talhelper** - Use for all multi-node operations

```bash
cd talos

# Regenerate Talos configs (use this instead of talhelper genconfig)
direnv reload

# Apply configurations to all nodes
talhelper gencommand apply | bash

# Bootstrap cluster (first time only)
talhelper gencommand bootstrap | bash

# Upgrade nodes (ALWAYS use --preserve flag)
talhelper gencommand upgrade --extra-flags="--preserve" | bash

# Upgrade Kubernetes
talhelper gencommand upgrade-k8s | bash

# Generate kubeconfig
talhelper gencommand kubeconfig | bash

# Target specific node
talhelper gencommand apply -n master1 | bash

# Shutdown cluster
talosctl shutdown --force
```

**⚠️ CRITICAL: New Node Initialization**

- MUST use `--insecure` flag when applying config to new nodes
- Required syntax: `talhelper gencommand apply --extra-flags="--insecure" | bash`
- New nodes don't have certificates yet

**⚠️ CRITICAL: Upgrade Operations**

- ALWAYS use `--preserve` flag for ALL upgrades
- Required syntax: `talhelper gencommand upgrade --extra-flags="--preserve" | bash`
- Without `--preserve`, you WILL lose data

**Direct talosctl Usage**

- Only use `talosctl` directly for single-node operations
- Example: `talosctl -n 192.168.1.10 get members`

### Git Workflow

```bash
# Check status
git status

# Commit and push (atomic operation)
git add . && git commit -m "message" && git push
```

**Commit Message Format** (conventional commits):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks
- `ci:` - CI/CD changes

## Configuration Files

### Talos

- `talconfig.yaml` - Main Talos configuration
- `talenv.sops.yaml` - Environment variables (encrypted)
- `talsecret.sops.yaml` - Secrets (encrypted)
- `clusterconfig/` - Generated configs (gitignored)

### Pulumi

- `Pulumi.yaml` - Project definition
- `Pulumi.home-cluster.yaml` - Stack configuration
- `package.json` - npm dependencies
- `tsconfig.json` - TypeScript configuration

## State Management

- **Pulumi State**: S3 backend (`s3://jdray-pulumi-state?region=us-east-1`)
- **Secrets**: SOPS with age encryption
- **Credentials**: AWS SSM Parameter Store for age key
