# Home-Cluster Ansible

This directory contains the Ansible automation for managing the home-cluster infrastructure.

## Main Roles and Their Purpose

- **storage**: Discovers, mounts, and pools storage disks. Handles storage cleanup and configures file sharing for the cluster.

- **users**: Manages system user accounts and their credentials across all hosts.

- **ssh-access**: Ensures SSH access is configured for cluster management and automation.

- **mdns**: Configures multicast DNS (mDNS) for service discovery within the local network.

## Usage

1. **Install dependencies**

   Run the provided script to download all required Ansible Galaxy roles and collections:

   ```sh
   ./setup-galaxy.sh
   ```

2. **Secrets Management**

   Secrets are managed using SOPS with Age encryption. The Age key is automatically available when using the Nix shell from the repository root.

3. **Running the Playbook**

   ```sh
   ansible-playbook -i inventory playbook.yml
   ```

   or on a single host:

   ```sh
   ansible-playbook -i inventory playbook.yml --limit hostname
   ```

4. **Managing Secrets**

   Secrets are stored in `group_vars/secrets.sops.yml` and encrypted with SOPS.

   - To **edit** secrets:

     ```sh
     sops group_vars/secrets.sops.yml
     ```

   - To **view** secrets:

     ```sh
     sops -d group_vars/secrets.sops.yml
     ```

See each role's README for more details on its configuration and variables.
