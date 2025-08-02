# Talos Command Usage Guidelines

## Primary Tool: talhelper

- Use `talhelper` for all multi-node operations
- Generate and apply commands using: `talhelper gencommand <command> | bash`
- This ensures consistent application across all defined nodes in talconfig.yaml

## Direct talosctl Usage

- Only use `talosctl` directly when targeting a single specific node
- For single node operations, use the `-n <node>` flag with talhelper when possible

## ⚠️ CRITICAL: Upgrade Operations

**ALWAYS USE `--preserve` FLAG FOR ALL UPGRADES - NO EXCEPTIONS**

- **MANDATORY**: Every upgrade command MUST include `--preserve` as an extra argument
- **REQUIRED SYNTAX**: `talhelper gencommand upgrade --extra-flags="--preserve" | bash`
- **WHY CRITICAL**: Without `--preserve`, you WILL lose important data during upgrades
- **APPLIES TO**: All upgrade operations (OS upgrades, node upgrades, etc.)

**⚠️ WARNING**: Never run upgrade commands without `--preserve` - this can cause data loss!

## Common Commands

- Apply configurations: `talhelper gencommand apply | bash`
- Bootstrap cluster: `talhelper gencommand bootstrap | bash`
- Upgrade nodes: `talhelper gencommand upgrade --extra-flags="--preserve" | bash`
- Upgrade Kubernetes: `talhelper gencommand upgrade-k8s | bash`
- Reset nodes: `talhelper gencommand reset | bash`
- Generate kubeconfig: `talhelper gencommand kubeconfig | bash`

## Configuration Files

- Main config: `talconfig.yaml`
- Generated configs stored in: `./clusterconfig/`
- Environment files: `talenv.yaml`, `talenv.sops.yaml`
- Secrets: `talsecret.sops.yaml`

## Best Practices

1. Always generate configs before applying: `direnv reload` (instead of `talhelper genconfig`)
2. Use SOPS for secret encryption
3. Never commit unencrypted secrets to version control
4. Validate configurations: `talhelper validate`
5. Use `--debug` flag for troubleshooting
6. Extension updates require both config apply AND upgrade to take effect

## Examples

```bash
# Generate and apply configuration to all nodes
talhelper gencommand apply | bash

# Upgrade all nodes with preserve flag
talhelper gencommand upgrade --extra-flags="--preserve" | bash

# Target specific node for single operations
talhelper gencommand apply -n master1 | bash

# Direct talosctl usage (only for single node operations)
talosctl -n 192.168.1.10 get members
```
