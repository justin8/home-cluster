# Home Cluster & Infrastructure Management

This repository contains tools, configurations, and automation for managing my home server cluster and related infrastructure. It is designed to streamline provisioning, configuration, and maintenance of services and hardware in a home lab environment.

## Prerequisites

- **Nix**: Package manager for reproducible development environments
- **direnv**: Automatic environment loading when entering the project directory
- **AWS credentials**: Required for downloading SOPS Age key from SSM Parameter Store

## Secrets Management

This repository uses multiple secret management approaches depending on the component:

### SOPS + Age

**Used for**: Talos configuration, Pulumi passphrases, and general YAML secrets

- **Configuration**: `.sops.yaml` defines encryption rules using Age public key
- **Key Storage**: Age private key stored in AWS SSM Parameter Store at `/home-cluster/sops-age.key`
- **Environment**: `SOPS_AGE_KEY_FILE` points to `.sops-age.key` (auto-downloaded by shell.nix)
- **Files**: `*.sops.yaml` files contain encrypted secrets (e.g., `pulumi/.pulumi-passphrase.sops.yaml`, `talos/talsecret.sops.yaml`)

### Pulumi Passphrases

**Used for**: Pulumi stack encryption

- **Storage**: Encrypted in `pulumi/.pulumi-passphrase.sops.yaml` using SOPS
- **Environment**: `PULUMI_CONFIG_PASSPHRASE` auto-decrypted via shell.nix
- **Access**: Automatically handled when entering the Nix shell

### Direnv + Nix

**Used for**: Development environment setup and secret loading

- **Configuration**: `.envrc` enables Nix shell integration
- **Automation**: `shell.nix` automatically downloads Age key and sets environment variables
- **Benefits**: Seamless secret access when entering the project directory

### Ansible + SOPS

**Used for**: Host configuration secrets

- **Storage**: `ansible/secrets.sops.yml` encrypted with Age
- **Plugin**: Uses `community.sops` collection for secret lookups
- **Configuration**: Age key path configured in `ansible/ansible.cfg`
- **Access**: Automatically available when using Nix shell

### Quick Start

1. **Enter development environment**: `cd` into repository (direnv + nix will auto-setup)
2. **Verify secrets access**: Age key and Pulumi passphrase should be automatically available
3. **For Ansible secrets**: Edit with `sops ansible/secrets.sops.yml`

## License

MIT License. See [LICENSE](LICENSE) for details.
