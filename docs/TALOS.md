# Talos Configuration Management

This directory contains Talos Linux cluster configuration managed with [talhelper](https://github.com/budimanjojo/talhelper).

## Prerequisites

All tools are automatically installed via direnv and nix when entering the project directory.

## Configuration Files

- `talconfig.yaml` - Main configuration file defining cluster settings
- `talsecret.sops.yaml` - Encrypted secrets (machine tokens, certificates)
- `clusterconfig/` - Generated Talos configuration files

## Cluster Creation and Initialization

### Initial Cluster Setup

1. **Generate initial configuration**:

   ```bash
   direnv reload
   ```

2. **Apply configuration to new nodes** (use `--insecure` for first-time setup):

   ```bash
   talhelper gencommand apply --extra-flags="--insecure" | bash
   ```

3. **Bootstrap the cluster** (run only once on the first control plane node):

   ```bash
   talhelper gencommand bootstrap | bash
   ```

### Post-Cluster Setup

After the cluster is running, install ArgoCD to handle everything else:

```bash
install-argocd
```

## Regenerating Configuration

After making changes to `talconfig.yaml`:

```bash
direnv reload
```

This automatically runs `talhelper genconfig` to regenerate all configuration files.

## Configuration Changes

### Shutdown Cluster

1. `talosctl shutdown --force`

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
3. Find the matching etcd member ID with `talosctl etc status` and then remove it from other nodes with `talosctl etcd remove-member $ID` (note that the members list will have an entry for each node pair, but you only need to perform the delete once for the deleted node. Also this command may hang even if it has completed)
4. Reset Talos node (wiping only STATE and EPHEMERAL preserves the boot partition so it reboots without a USB key): `talosctl reset --nodes <node-ip> --reboot --graceful=false --system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL`
5. Remove node definition from `talconfig.yaml`
6. Run `direnv reload` to regenerate configs (or just press enter as it should be automatic)
7. Apply changes: `talhelper gencommand apply | bash`

### Replacing / Resetting an Existing Controlplane Node

When replacing or resetting an existing controlplane node (e.g. replacing hardware or re-bootstrapping a node):

1. **Clean up old etcd & node references**:
   - Drain the node (if responsive): `kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --force`
   - Check etcd membership from an active controlplane node:
     ```bash
     talosctl -n <active-node-ip> etcd members
     ```
   - If the old member ID exists, remove it:
     ```bash
     talosctl -n <active-node-ip> etcd remove-member <member-id>
     ```
   - Remove stale K8s node resource if present: `kubectl delete node <node-name>`

2. **Reset / Wipe the target node**:
   - Reset the target node, wiping only `STATE` and `EPHEMERAL` partitions (preserving the boot partition so the node boots back into maintenance mode without needing USB boot media):
     ```bash
     talosctl -n <target-node-ip> reset --reboot --graceful=false --system-labels-to-wipe STATE --system-labels-to-wipe EPHEMERAL
     ```

3. **Re-apply Talos configuration**:
   - Once the node boots into maintenance mode, apply the generated controlplane config:
     ```bash
     talosctl apply-config --insecure -f clusterconfig/home-cluster-controlplane.yaml -n <target-node-ip>
     ```

4. **Verify etcd & local LAN routing**:
   - Verify etcd peer URLs use local LAN IPs (`192.168.5.x`) rather than Tailscale IPs:
     ```bash
     talosctl -n <target-node-ip> etcd members
     ```
   - Confirm all Talos services are healthy:
     ```bash
     talosctl -n <target-node-ip> service
     ```

5. **Remediate Longhorn disk registration**:
   - Because the target node was re-formatted with a new filesystem UUID on `/var/lib/longhorn`, Longhorn will flag `DiskFilesystemChanged`. Follow the remediation steps in [`docs/LONGHORN.md`](file:///Users/justindray/src/home-cluster/docs/LONGHORN.md#L141) to adopt the fresh disk.

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

Secrets for Talos are encrypted with SOPS and automatically decrypted when using the nix shell environment.

To edit secrets:

```bash
sops talsecret.sops.yaml
```
