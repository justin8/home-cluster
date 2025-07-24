# shell.nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    (python312.withPackages(ps: with ps; [
      uv
    ]))
    git
    sops
    age
    talosctl
    #talhelper # Need to update to the next nix release for this to be included
    kubectl
    pulumi
    pulumiPackages.pulumi-language-nodejs
  ];

  shellHook = ''
    uv sync
    source .venv/bin/activate
    if [[ ! -e .sops-age.key ]]; then
      echo "Downloading age key..."
      aws ssm get-parameter --name "/home-cluster/sops-age.key" --with-decryption --query "Parameter.Value" --output text > .sops-age.key
    fi

    (
      cd talos
      talhelper genconfig
      talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.4.8 clusterconfig/kubeconfig
    )

    export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES # Needed for macOS versions after High Sierra
    export AWS_REGION=ap-southeast-2
    export TALOSCONFIG=$PWD/talos/clusterconfig/talosconfig
    export KUBECONFIG=$PWD/talos/clusterconfig/kubeconfig
    export SOPS_AGE_KEY_FILE=$PWD/.sops-age.key
    export PULUMI_CONFIG_PASSPHRASE="$(sops decrypt --extract '["passphrase"]' pulumi/.pulumi-passphrase.sops.yaml)"
  '';
}

