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

2. **AWS Credentials**

   Some secrets (such as passwords or tokens) are stored in AWS Secrets Manager. Ensure you have valid AWS credentials (e.g., via `~/.aws/credentials` or environment variables) before running playbooks that access secrets.

3. **Running the Playbook**

   ```sh
   ansible-playbook -i inventory playbook.yml
   ```

   or on a single host:

   ```sh
   ansible-playbook -i inventory playbook.yml --limit hostname
   ```

4. **Managing Secrets**
   - Secrets are automatically prefixed with /home-cluster, so for example a user's password will be 'users/$username/password' for the secret name

   - To **read** a secret:

     ```sh
     ./get-parameter <secret-name>
     ```

   - To **update** a secret:

     ```sh
     ./put-parameter <secret-name> <value>
     ```

See each role's README for more details on its configuration and variables.
