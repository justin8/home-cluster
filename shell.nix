# shell.nix
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22
    git
    sops
    age
    talosctl
    talhelper
    kubectl
    kubectl-cnpg
    kubernetes-helm
    prettier
    pulumi
    pulumiPackages.pulumi-language-nodejs
    pv
    skopeo
    k9s
  ];

  shellHook = ''
    export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES # Needed for macOS versions after High Sierra
    export AWS_REGION=ap-southeast-2
    export TALOSCONFIG=$PWD/talos/clusterconfig/talosconfig
    export KUBECONFIG=$PWD/talos/clusterconfig/kubeconfig
    export SOPS_AGE_KEY_FILE=$PWD/.sops-age.key
    export PATH=$PWD/scripts:$PATH

    if [[ $GITHUB_ACTIONS != "true" ]]; then
      git submodule update --init --recursive
    fi

    if [[ ! -s .sops-age.key ]]; then
      echo "Downloading age key..."
      aws --region us-east-1 ssm get-parameter --name "/home-cluster/sops-age.key" --with-decryption --query "Parameter.Value" --output text > $SOPS_AGE_KEY_FILE
    fi

    export PULUMI_CONFIG_PASSPHRASE="$(sops decrypt --extract '["passphrase"]' pulumi/.pulumi-passphrase.sops.yaml)"

    # Install git hooks
    echo "Installing git hooks..."
    cp git-hooks/* .git/hooks/
    chmod +x .git/hooks/*

    (
      echo "Configuring talos..."
      cd talos
      talhelper genconfig
      talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.5.10 clusterconfig/kubeconfig
    )

    (
      echo "Configuring pulumi..."
      cd pulumi
      if [[ ! -e $HOME/.pulumi/credentials.json ]]; then
        pulumi login 's3://jdray-pulumi-state?region=us-east-1'
      fi

      npm i
    )
  '';
}

