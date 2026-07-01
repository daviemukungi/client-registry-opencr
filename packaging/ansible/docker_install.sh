#!/usr/bin/env bash
set -ex

# Sets up a docker-based OpenCR installation on a fresh Ubuntu/Debian server.
# Assumes an inventory file at ./hosts.
# Run: bash docker_install.sh

# Collect the initial admin username once here so vars_prompt in user.yaml is
# suppressed (-e takes precedence) and the same value is used consistently.
read -rp "Enter the admin username on the target server (e.g. ubuntu, root): " ADMIN_USER

# --forks 1 to prevent host-key checking failures on first connection
# https://github.com/ansible/ansible/issues/25068
# -K prompts once for the sudo password needed to create the opencr user
ansible-playbook -i hosts user.yaml --forks 1 -e user="$ADMIN_USER" --ask-become-pass

# prep_docker installs Docker system-wide; run as the admin user with sudo
ansible-playbook -i hosts prep_docker.yaml -e user="$ADMIN_USER" --ask-become-pass

# deploy runs as the admin user (in the docker group after prep)
ansible-playbook -i hosts deploy_docker.yaml -e user="$ADMIN_USER"
