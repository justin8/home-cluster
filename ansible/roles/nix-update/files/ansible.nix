{
  config,
  lib,
  pkgs,
  ...
}: 
let
  ansiblePullCmd = "${pkgs.ansible}/bin/ansible-pull -U https://github.com/justin8/home-cluster.git -d /var/lib/ansible/local -i ansible/inventory ansible/playbook.yml";
in
{
  # Install Ansible
  environment.systemPackages = with pkgs; [
    ansible
  ];

  # Add cron jobs to run ansible-pull every 10 minutes and at reboot
  services.cron.systemCronJobs = [
    "@reboot root sleep 30; ${ansiblePullCmd} >> /var/log/ansible-pull.log 2>&1"
    "*/10 * * * * root ${ansiblePullCmd} >> /var/log/ansible-pull.log 2>&1"
  ];
}