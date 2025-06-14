#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "click",
#     "paramiko",
#     "rich",
# ]
# ///

import json
import os
import shutil
import subprocess
import tempfile
import time

import click
import paramiko
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

# The contents of image-build.nix
IMAGE_BUILD_NIX = """{
  config,
  lib,
  pkgs,
  ...
}: {

  imports = [
    ./ansible.nix
    # other modules...
  ];

  # Enable nix-command and flakes
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # System packages
  environment.systemPackages = with pkgs; [
    neovim
    git
  ];

  services.getty.autologinUser = lib.mkOverride 999 "root";

  # Networking
  networking.hostName = "$HOSTNAME";
  networking.firewall.enable = true;
    
  system.stateVersion = config.system.nixos.release;

}
"""

# Settings file path
SETTINGS_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".build-vm-settings"
)


def load_settings():
    """Load settings from the settings file."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}


def save_settings(settings):
    """Save settings to the settings file."""
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f)


def prepare_build_files(temp_dir, hostname):
    """Prepare the build files in the temporary directory."""
    # Write image-build.nix with hostname
    image_nix_path = os.path.join(temp_dir, "image-build.nix")
    with open(image_nix_path, "w") as f:
        f.write(IMAGE_BUILD_NIX.replace("$HOSTNAME", hostname))

    # Copy ansible.nix
    ansible_nix_src = os.path.join(
        os.getcwd(), "ansible/roles/nix-update/files/ansible.nix"
    )
    ansible_nix_dst = os.path.join(temp_dir, "ansible.nix")
    shutil.copy(ansible_nix_src, ansible_nix_dst)

    return image_nix_path


def build_vm_image_file(image_nix_path, hostname, expected_build_time):
    """Build the VM image and show progress."""
    cmd = [
        "nixos-generate",
        "-f",
        "qcow",
        "--disk-size",
        "32768",
        "-I",
        "nixpkgs=channel:nixos-25.05",
        "-c",
        image_nix_path,
    ]

    # Setup progress display
    with Progress(
        SpinnerColumn(),
        TextColumn(
            f"[bold blue]Building VM image for {hostname!r}...", justify="right"
        ),
        BarColumn(complete_style="green"),
        TimeElapsedColumn(),
        TimeRemainingColumn(),
    ) as progress:
        task = progress.add_task("Building...", total=expected_build_time)

        # Start timing
        start_time = time.time()

        # Start the build process
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )

        # Update progress while process is running
        while process.poll() is None:
            if expected_build_time:
                elapsed = time.time() - start_time
                progress.update(task, completed=min(elapsed, expected_build_time))
            time.sleep(0.1)

        # Process completed
        stdout, stderr = process.communicate()

        # Record build time
        build_time = time.time() - start_time

        if process.returncode != 0:
            progress.stop()
            raise Exception(f"Error building image: {stderr}")

        # Complete the progress bar
        progress.update(
            task,
            completed=expected_build_time if expected_build_time else 100,
            total=100,
        )

    # Extract the image path from output
    image_path = stdout.strip()
    return image_path, build_time


def deploy_to_proxmox(image_path, vm_id, vm_host):
    """Deploy the image to a Proxmox host."""
    # Parse user@host format
    if "@" in vm_host:
        username, hostname = vm_host.split("@", 1)
    else:
        username = os.environ.get("USER")
        hostname = vm_host

    # Connect to the host using Paramiko
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname, username=username)

        # Stop the VM
        click.echo(f"Stopping VM {vm_id} on {vm_host}...")
        stdin, stdout, stderr = client.exec_command(f"qm stop {vm_id}")
        exit_status = stdout.channel.recv_exit_status()

        # Wait for VM to stop with retries
        max_retries = 5
        retry_delay = 2
        for attempt in range(max_retries):
            time.sleep(retry_delay)
            stdin, stdout, stderr = client.exec_command(f"qm status {vm_id}")
            status_output = stdout.read().decode("utf-8")
            if "status: stopped" in status_output:
                click.echo("VM stopped successfully")
                break
            click.echo(
                f"Waiting for VM to stop (attempt {attempt + 1}/{max_retries})..."
            )
            retry_delay *= 1.5  # Exponential backoff
        else:
            click.echo("Failed to stop VM after multiple attempts")
            client.close()
            return False

        # Copy the image to the host using SFTP with progress bar
        remote_path = f"/var/lib/vz/images/{vm_id}/vm-{vm_id}-disk-0.qcow2"
        click.echo(f"Copying image to {vm_host}:{remote_path}...")

        # Get file size
        file_size = os.path.getsize(image_path)

        # Setup progress bar for file transfer
        with Progress(
            TextColumn("[bold blue]Uploading...", justify="right"),
            BarColumn(complete_style="green"),
            TextColumn("[progress.percentage]{task.percentage:>3.1f}%"),
            TextColumn("•"),
            TimeElapsedColumn(),
            TextColumn("•"),
            TimeRemainingColumn(),
            TextColumn("•"),
            TextColumn("{task.fields[speed]:.2f} MB/s"),
        ) as progress:
            task = progress.add_task("Uploading", total=file_size, speed=0)

            # Open SFTP connection
            sftp = client.open_sftp()

            # Track transfer speed
            start_time = time.time()
            last_update_time = start_time
            last_bytes = 0

            # Define callback for progress updates
            def update_progress(transferred, total):
                nonlocal last_update_time, last_bytes

                # Update progress bar
                progress.update(task, completed=transferred)

                # Calculate and update speed every second
                current_time = time.time()
                if current_time - last_update_time >= 1.0:
                    elapsed = current_time - last_update_time
                    bytes_since_last = transferred - last_bytes
                    speed_mbps = (bytes_since_last / 1024 / 1024) / elapsed
                    progress.update(task, speed=speed_mbps)

                    # Update tracking variables
                    last_update_time = current_time
                    last_bytes = transferred

            # Start transfer with callback
            sftp.put(image_path, remote_path, callback=update_progress)
            sftp.close()

        # Start the VM
        click.echo(f"Starting VM {vm_id}...")
        stdin, stdout, stderr = client.exec_command(f"qm start {vm_id}")
        exit_status = stdout.channel.recv_exit_status()

        client.close()
        click.echo("VM deployment complete")
        return True

    except Exception as e:
        click.echo(f"Error during SSH operations: {str(e)}")
        return False


@click.command()
@click.option("--vm-id", help="VM ID for Proxmox")
@click.option("--vm-host", help="VM host in ssh user@host format")
@click.argument("hostname", required=True)
def main(vm_id, vm_host, hostname):
    """Build a NixOS VM image and optionally deploy it to Proxmox."""

    # Validate options
    if (vm_id is None) != (vm_host is None):
        click.echo("Error: Both --vm-id and --vm-host must be specified together")
        return 1

    # Load settings
    settings = load_settings()
    expected_build_time = settings.get("expected_build_time", 30)

    try:
        # Create temp directory only for the build process
        with tempfile.TemporaryDirectory() as temp_dir:
            # Prepare build files
            image_nix_path = prepare_build_files(temp_dir, hostname)

            # Build the image
            image_path, build_time = build_vm_image_file(
                image_nix_path, hostname, expected_build_time
            )

        # Save the build time for future runs
        settings["expected_build_time"] = build_time
        save_settings(settings)

        click.echo(f"Image built successfully in {build_time:.1f}s: {image_path}")

        # If VM ID and host are specified, deploy the image
        if vm_id and vm_host:
            if not deploy_to_proxmox(image_path, vm_id, vm_host):
                return 1
        else:
            click.echo("VM ID and host not specified, skipping deployment")

        return 0

    except Exception as e:
        click.echo(f"Error: {str(e)}")
        return 1


if __name__ == "__main__":
    main()
