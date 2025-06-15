#!/bin/bash

cd "$(dirname "$0")" || exit 1

ansible-galaxy role install -r requirements.yml -p ./galaxy_roles
ansible-galaxy collection install -r requirements.yml -p ./galaxy_collections
