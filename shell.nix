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
        if ! err=$(kubectl krew install "$plugin" 2>&1); then
          echo "Failed to install kubectl $plugin plugin:" >&2
          echo "$err" >&2
        fi
      fi
    done

    # Allow ktop to be run directly as `ktop` in addition to `kubectl ktop`
    if command -v kubectl-ktop >/dev/null 2>&1 && ! command -v ktop >/dev/null 2>&1; then
      if ! err=$(ln -sf "$(command -v kubectl-ktop)" "''${KREW_ROOT:-$HOME/.krew}/bin/ktop" 2>&1); then
        echo "Failed to link ktop:" >&2
        echo "$err" >&2
      fi
    fi

    if ! err=$(git submodule update --init --recursive 2>&1); then
      echo "Failed to update git submodules:" >&2
      echo "$err" >&2
    fi

    # Install git hooks
    if [[ -d git-hooks && -d .git/hooks ]]; then
      if ! err=$(cp git-hooks/* .git/hooks/ 2>&1 && chmod +x .git/hooks/* 2>&1); then
        echo "Failed to install git hooks:" >&2
        echo "$err" >&2
      fi
    fi

    if [[ ! -s "$SOPS_AGE_KEY_FILE" ]]; then
      if key=$(aws --region us-east-1 ssm get-parameter --name "/home-cluster/sops-age.key" --with-decryption --query "Parameter.Value" --output text 2>&1); then
        printf '%s\n' "$key" > "$SOPS_AGE_KEY_FILE"
      else
        echo "Failed to download age key:" >&2
        echo "$key" >&2
      fi
    fi

    (
      cd talos || exit 1
      if ! err=$(talhelper genconfig 2>&1); then
        echo "Failed to generate talos config:" >&2
        echo "$err" >&2
      fi
      if ! err=$(talosctl kubeconfig --talosconfig=./clusterconfig/talosconfig --force --nodes=192.168.5.20 --endpoints=192.168.5.20 clusterconfig/kubeconfig 2>&1); then
        echo "Failed to fetch talos kubeconfig:" >&2
        echo "$err" >&2
      fi
    )
  '';
}

