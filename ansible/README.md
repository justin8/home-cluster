# Ansible DNSMasq Setup

This project provides an Ansible playbook to install and configure `dnsmasq` on target hosts. It includes the necessary roles, tasks, and templates to ensure that `dnsmasq` is properly set up and running.

## Setup Instructions

```bash
ansible-pull -U https://github.com/justin8/au-dns.git -i inventory playbook.yml
```

## Usage

After running the playbook, `dnsmasq` will be installed and configured on the specified hosts. You can modify the `/etc/dnsmasq.hosts` file by updating the `hosts.j2` template, and `dnsmasq` will be restarted automatically if changes are detected.
