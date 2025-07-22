# shell.nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    (python312.withPackages(ps: with ps; [
      uv
    ]))
    git
    sops
    talosctl
    #talhelper # Need to update to the next nix release for this to be included
    kubectl
    google-cloud-sdk
  ];

  shellHook = ''
    uv sync
    source .venv/bin/activate

    (
      cd talos
      talhelper genconfig
      talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.4.8 clusterconfig/kubeconfig
    )
  '';
}

