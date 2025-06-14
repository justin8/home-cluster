{
  config,
  lib,
  pkgs,
  ...
}: {
  # Install Ansible
  environment.systemPackages = with pkgs; [
    ansible
  ];

  # Set up systemd service for ansible-pull
  systemd.services.ansible-pull = {
    description = "Run ansible-pull to update system configuration";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];
    
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.ansible}/bin/ansible-pull -U https://github.com/justin8/home-cluster.git -d /var/lib/ansible/local -i ansible/inventory ansible/playbook.yml";
      StandardOutput = "append:/var/log/ansible-pull.log";
      StandardError = "append:/var/log/ansible-pull.log";
    };
  };

  # Timer to run ansible-pull periodically
  systemd.timers.ansible-pull = {
    description = "Timer for ansible-pull";
    wantedBy = [ "timers.target" ];
    
    timerConfig = {
      OnBootSec = "30";
      OnUnitActiveSec = "10min";
      Unit = "ansible-pull.service";
    };
  };
}