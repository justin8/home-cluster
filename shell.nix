# shell.nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    (python312.withPackages(ps: with ps; [
      uv
      boto3
    ]))
    git
    ansible
    ansible-lint
  ];

  shellHook = ''
    # optionally activate a virtualenv here
  '';
}

