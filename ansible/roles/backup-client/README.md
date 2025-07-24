# Ansible Role: backup-client

This role installs and configures borgbackup and borgmatic for automated backups.

## Variables

- `backup_source_directories` (list, required): Directories to back up.
- `secret_backup_repository_host` (string, required): SSH host for the backup repository (e.g., `demeter.dray.id.au`).
- `backup_exclude_patterns` (list, optional): Patterns to exclude from backup.
- `secret_backup_encryption_passphrase` (string, required): Encryption passphrase, should be securely managed.
- `backup_retention` (dict, optional): Retention policy. Defaults: `{ keep_daily: 7, keep_weekly: 4 }`
- `backup_healthcheck_url` (string, optional): If set, adds a healthchecks.io ping URL to the config.
- `backup_before_commands` (list, optional): Commands to run before backup (see below).
- `backup_after_commands` (list, optional): Commands to run after backup (see below).

## Example Playbook

```yaml
- hosts: all
  roles:
    - role: backup-client
      vars:
        backup_source_directories:
          - /home
          - /etc
        secret_backup_repository_host: demeter.dray.id.au
        backup_exclude_patterns:
          - '*.cache'
          - '*.tmp'
        secret_backup_encryption_passphrase: "{{ lookup('aws_ssm', 'secret_backup_encryption_passphrase', region='ap-southeast-2') }}"
        backup_retention:
          keep_daily: 7
          keep_weekly: 4
        backup_healthcheck_url: "https://hc-ping.com/your-uuid"
        backup_before_commands:
          - /usr/local/bin/notify-backup-start.sh
        backup_after_commands:
          - /usr/local/bin/notify-backup-end.sh
```

## Notes

- The repository will be `ssh://<host>/./borg/<inventory_hostname>`.
- `.nobackup` is always excluded if present in a directory.
- The passphrase should be securely managed and pulled from SSM or a similar secret manager.
- If `backup_healthcheck_url` is set, it will be included in the config under `healthchecks: ping_url:`.
- If `backup_before_commands` or `backup_after_commands` are set, they will be rendered in the `commands:` section of the borgmatic config using the modern syntax.
