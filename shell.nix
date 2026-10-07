# shell.nix
{ pkgs ? import <nixpkgs> { } }:

let
  kubectl-krew = pkgs.runCommand "kubectl-krew" { } ''
    mkdir -p $out/bin
    ln -s ${pkgs.krew}/bin/krew $out/bin/kubectl-krew
  '';
in
pkgs.mkShell {
  buildInputs = with pkgs; [
    age
    argocd
    cilium-cli
    coreutils # for base64
    git
    github-cli
    hubble
    jq
    k9s
    krew
    kubectl
    kubectl-cnpg
    kubectl-krew
    kubernetes-helm
    kubeseal
    prettier
    pv
    rtk
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
    export PATH="''${KREW_ROOT:-$HOME/.krew}/bin:$PWD/scripts:$PATH"

    # Install krew plugins if not available
    for plugin in view-allocations ktop; do
      cmd_hyphen="kubectl-$plugin"
      cmd_underscore="kubectl-''${plugin//-/_}"
      if ! command -v "$cmd_hyphen" >/dev/null 2>&1 && ! command -v "$cmd_underscore" >/dev/null 2>&1; then
        echo "Installing kubectl $plugin plugin..."
        kubectl krew install "$plugin"
      fi
    done

    # Allow ktop to be run directly as `ktop` in addition to `kubectl ktop`
    if command -v kubectl-ktop >/dev/null 2>&1 && ! command -v ktop >/dev/null 2>&1; then
      ln -sf "$(command -v kubectl-ktop)" "''${KREW_ROOT:-$HOME/.krew}/bin/ktop"
    fi

    git submodule update --init --recursive

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
      talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.5.20 --endpoints=192.168.5.20 clusterconfig/kubeconfig
    )
  '';
}

