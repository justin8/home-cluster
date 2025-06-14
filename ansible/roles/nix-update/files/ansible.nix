{
  config,
  lib,
  pkgs,
  ...
}: let
  ansiblePullCmd = "${pkgs.ansible}/bin/ansible-pull -U https://github.com/justin8/home-cluster.git -d /var/lib/ansible/local -i ansible/inventory ansible/playbook.yml >> /var/log/ansible-pull.log 2>&1";
in {
  # Install Ansible
  environment.systemPackages = with pkgs; [
    ansible
  ];

  # Set up cron jobs for ansible-pull
  services.cron = {
    enable = true;
    systemCronJobs = [
      "*/10 * * * * root ${ansiblePullCmd}"
      "@reboot root ${ansiblePullCmd}"
    ];
  };
}