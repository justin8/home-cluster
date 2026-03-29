# shell.nix
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    age
    argocd
    git
    jq
    k9s
    kubectl
    kubectl-cnpg
    kubernetes-helm
    kubeseal
    prettier
    pv
    skopeo
    sops
    talhelper
    talosctl
    virt-manager
    yq
  ];

  shellHook = ''
    export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES # Needed for macOS versions after High Sierra
    export AWS_REGION=ap-southeast-2
    export TALOSCONFIG=$PWD/talos/clusterconfig/talosconfig
    export KUBECONFIG=$PWD/talos/clusterconfig/kubeconfig
    export SOPS_AGE_KEY_FILE=$PWD/.sops-age.key
    export PATH=$PWD/scripts:$PATH

    git submodule update --init --recursive

    # Cleanup old talos configs
    rm -rf talos/clusterconfig

    # Install git hooks
    echo "Installing git hooks..."
    cp git-hooks/* .git/hooks/
    chmod +x .git/hooks/*

    if [[ ! -s .sops-age.key ]]; then
      echo "Downloading age key..."
      aws --region us-east-1 ssm get-parameter --name "/home-cluster/sops-age.key" --with-decryption --query "Parameter.Value" --output text > $SOPS_AGE_KEY_FILE
    fi

    (
      echo "Configuring talos..."
      cd talos
      talhelper genconfig
      talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.5.20 clusterconfig/kubeconfig
    )
  '';
}

