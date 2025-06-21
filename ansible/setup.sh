#!/bin/bash

cd "$(dirname "$0")" || exit 1

ansible-galaxy role install -r requirements.yml -p ./galaxy_roles
ansible-galaxy collection install -r requirements.yml -p ./galaxy_collections

if ! [[ -e .mitogen ]]; then
  mkdir .mitogen
  curl -Lo /tmp/mitogen.tar.gz https://files.pythonhosted.org/packages/source/m/mitogen/mitogen-0.3.24.tar.gz
  tar xf /tmp/mitogen.tar.gz -C .mitogen/ --strip-components=1
fi
