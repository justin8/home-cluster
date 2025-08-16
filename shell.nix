# shell.nix
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    (python312.withPackages (ps: with ps; [ uv ]))
    nodejs_22
    git
    sops
    age
    talosctl
    #talhelper # Need to update to the next nix release for this to be included
    kubectl
    kubernetes-helm
    pulumi
    pulumiPackages.pulumi-language-nodejs
    skopeo
    k9s
  ];

  shellHook = ''
    export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES # Needed for macOS versions after High Sierra
    export AWS_REGION=ap-southeast-2
    export TALOSCONFIG=$PWD/talos/clusterconfig/talosconfig
    export KUBECONFIG=$PWD/talos/clusterconfig/kubeconfig
    export SOPS_AGE_KEY_FILE=$PWD/.sops-age.key
    export PULUMI_CONFIG_PASSPHRASE="$(sops decrypt --extract '["passphrase"]' pulumi/.pulumi-passphrase.sops.yaml)"
    export PATH=$PWD/scripts:$PATH

    git submodule update --init --recursive

    if [[ ! -e .sops-age.key ]]; then
      echo "Downloading age key..."
      aws ssm get-parameter --name "/home-cluster/sops-age.key" --with-decryption --query "Parameter.Value" --output text > .sops-age.key
    fi

    # Install git hooks
    echo "Installing git hooks..."
    cp git-hooks/* .git/hooks/
    chmod +x .git/hooks/*

    uv sync
    source .venv/bin/activate

    (
      cd talos
      talhelper genconfig
      talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.4.8 clusterconfig/kubeconfig
    )

    (
      cd pulumi
      if [[ ! -e $HOME/.pulumi/credentials.json ]]; then
        pulumi login 's3://jdray-pulumi-state?region=us-east-1'
      fi
    )
  '';
}

