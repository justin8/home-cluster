# Talos Configuration Management

This directory contains Talos Linux cluster configuration managed with [talhelper](https://github.com/budimanjojo/talhelper).

## Prerequisites

All tools are automatically installed via direnv and nix when entering the project directory.

## Configuration Files

- `talconfig.yaml` - Main configuration file defining cluster settings
- `talsecret.sops.yaml` - Encrypted secrets (machine tokens, certificates)
- `clusterconfig/` - Generated Talos configuration files

## Regenerating Configuration

After making changes to `talconfig.yaml`:

```bash
direnv reload
```

This automatically runs `talhelper genconfig` to regenerate all configuration files.

## Configuration Changes

### Modifying Cluster Settings

1. Edit `talconfig.yaml`
2. Run `direnv reload` to regenerate configs (or just press enter as it should be automatic)
3. Apply changes: `talhelper gencommand apply | bash`

### Adding New Nodes

1. Add node definition to `talconfig.yaml`
2. Run `direnv reload` to regenerate configs (or just press enter as it should be automatic)
3. Apply config to new node: `talosctl apply-config --insecure -f clusterconfig/home-cluster-controlplane.yaml -n <node-ip>`

### Removing Nodes

**WARNING:** If you are removing multiple nodes, make sure all of the Longhorn volumes are in a healthy state before each one

1. Drain the node: `kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --force`
   - Note that Longhorn will show volumes from the node being removed as degraded; after ~30 minutes it will start to automatically re-allocate if the node doesn't come back online
2. Remove from Kubernetes: `kubectl delete node <node-name>`
3. Reset Talos node: `talosctl reset --nodes <node-ip> --graceful=false`
4. Remove node definition from `talconfig.yaml`
5. Run `direnv reload` to regenerate configs (or just press enter as it should be automatic)
6. Apply changes: `talhelper gencommand apply | bash`

## Upgrades

### Kubernetes Upgrades

1. Update `kubernetesVersion` in `talconfig.yaml`
2. Run `direnv reload`
3. Apply updated config: `talhelper gencommand apply | bash`
4. Upgrade Kubernetes: `talhelper gencommand upgrade-k8s | bash`

### Talos Upgrades

**⚠️ CRITICAL: Always use `--preserve` flag to avoid data loss such as Longhorn volume data**

1. Update `talosVersion` in `talconfig.yaml`
2. Run `direnv reload`
3. Upgrade nodes with preservation:
   ```bash
   talhelper gencommand upgrade --extra-flags "--preserve" | bash
   ```

**Without `--preserve` flag, all Longhorn data will be wiped during upgrades.**

### Using talhelper gencommand

Generate and execute commands:

```bash
# Generate and run Talos upgrade commands
talhelper gencommand upgrade --extra-flags "--preserve" | bash

# Generate and run Kubernetes upgrade commands
talhelper gencommand upgrade-k8s | bash

# Generate and run bootstrap command
talhelper gencommand bootstrap | bash

# Generate and run apply commands
talhelper gencommand apply | bash
```

## Secrets Management

Secrets are encrypted with SOPS and automatically decrypted when using the nix shell environment.

To edit secrets:

```bash
sops talsecret.sops.yaml
```
