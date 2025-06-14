{
  config,
  lib,
  pkgs,
  ...
}: {

  imports = [
    ./ansible.nix
    # other modules...
  ];

  # Enable nix-command and flakes
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # System packages
  environment.systemPackages = with pkgs; [
    neovim
    git
  ];

  services.sshd.enable = true;
  services.openssh.settings.PermitRootLogin = lib.mkOverride 999 "yes";

  # Delete this eventually, this is just for testing
  services.getty.autologinUser = lib.mkOverride 999 "root";
  users.users.root = {
    password = "nixos";
    openssh.authorizedKeys.keys = [
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBF88ymIneFCORv9MOMjHDWD5dswKXM/nbRNtuUP3uS0Icu0ROvWKjP6JWow2PCERWx6YVQV7adzzqUhI1K18W8Q= justin@hades"
    ];
  };

  # Networking
  networking.hostName = "storage";
  networking.firewall.enable = false;
    
  system.stateVersion = config.system.nixos.release;

}
