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


def build_vm_image_file(
    image_nix_path, hostname, expected_build_time, verbose=False, disk_size=32768
):
    """Build the VM image and show progress or verbose output."""
    cmd = [
        "nixos-generate",
        "-f",
        "qcow",
        "--disk-size",
        str(disk_size),
        "-I",
        "nixpkgs=channel:nixos-25.05",
        "-c",
        image_nix_path,
    ]

    if verbose:
        click.echo(f"[VERBOSE] Running command: {' '.join(cmd)}")
        start_time = time.time()
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
        )
        stdout_lines = []
        stderr_lines = []
        if process.stdout is not None and process.stderr is not None:
            import queue
            from threading import Thread

            q = queue.Queue()

            def enqueue_output(pipe, tag):
                for line in iter(pipe.readline, ""):
                    q.put((tag, line))
                pipe.close()

            threads = [
                Thread(target=enqueue_output, args=(process.stdout, "STDOUT")),
                Thread(target=enqueue_output, args=(process.stderr, "STDERR")),
            ]
            for t in threads:
                t.daemon = True
                t.start()
            while True:
                try:
                    tag, line = q.get(timeout=0.1)
                    if tag == "STDOUT":
                        click.echo(f"[STDOUT] {line.rstrip()}")
                        stdout_lines.append(line)
                    else:
                        click.echo(f"[STDERR] {line.rstrip()}")
                        stderr_lines.append(line)
                except queue.Empty:
                    if process.poll() is not None:
                        break
            for t in threads:
                t.join()
        else:
            # Fallback: just wait for process to finish
            stdout, stderr = process.communicate()
            if stdout:
                click.echo(f"[STDOUT] {stdout}")
                stdout_lines.append(stdout)
            if stderr:
                click.echo(f"[STDERR] {stderr}")
                stderr_lines.append(stderr)
        build_time = time.time() - start_time
        if process.returncode != 0:
            raise Exception(
                f"Error building image (see above for details): {''.join(stderr_lines)}"
            )
        # Try to get the last non-empty line as the image path
        all_stdout = "".join(stdout_lines).strip().split("\n")
        image_path = next(
            (image_line for image_line in reversed(all_stdout) if image_line.strip()),
            "",
        )
        return image_path, build_time

    # Non-verbose: use progress bar
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
        start_time = time.time()
        over_time = False
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        while process.poll() is None:
            elapsed = time.time() - start_time
            if not over_time and elapsed >= expected_build_time:
                over_time = True
                progress.update(
                    task,
                    description="[yellow]Still building (taking longer than expected)...",
                )
            progress.update(task, completed=elapsed)
            time.sleep(0.1)
        stdout, stderr = process.communicate()
        build_time = time.time() - start_time
        if process.returncode != 0:
            progress.stop()
            raise Exception(f"Error building image: {stderr}")
        progress.update(
            task,
            completed=build_time,
            total=max(build_time, expected_build_time),
        )
    image_path = stdout.strip()
    return image_path, build_time


def deploy_to_proxmox(image_path, vm_id, vm_host, verbose=False):
    """Deploy the image to a Proxmox host."""
    # Parse user@host format
    if "@" in vm_host:
        username, hostname = vm_host.split("@", 1)
    else:
        username = os.environ.get("USER")
        hostname = vm_host

    if verbose:
        click.echo(f"[VERBOSE] Connecting to {username}@{hostname}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname, username=username)

        # Stop the VM
        click.echo(f"Stopping VM {vm_id} on {vm_host}...")
        stdin, stdout, stderr = client.exec_command(f"qm stop {vm_id}")
        _ = stdout.channel.recv_exit_status()
        if verbose:
            click.echo(f"[VERBOSE] Ran: qm stop {vm_id}")
            click.echo(f"[VERBOSE] stdout: {stdout.read().decode('utf-8')}")
            click.echo(f"[VERBOSE] stderr: {stderr.read().decode('utf-8')}")

        # Wait for VM to stop with retries
        max_retries = 5
        retry_delay = 2
        for attempt in range(max_retries):
            time.sleep(retry_delay)
            stdin, stdout, stderr = client.exec_command(f"qm status {vm_id}")
            status_output = stdout.read().decode("utf-8")
            if verbose:
                click.echo(f"[VERBOSE] Ran: qm status {vm_id}")
                click.echo(f"[VERBOSE] stdout: {status_output}")
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
        file_size = os.path.getsize(image_path)
        if verbose:
            click.echo(f"[VERBOSE] Local image: {image_path} ({file_size} bytes)")
            click.echo(f"[VERBOSE] Remote path: {remote_path}")
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
            disable=verbose,
        ) as progress:
            task = progress.add_task("Uploading", total=file_size, speed=0)
            sftp = client.open_sftp()
            start_time = time.time()
            last_update_time = start_time
            last_bytes = 0

            def update_progress(transferred, total):
                nonlocal last_update_time, last_bytes
                progress.update(task, completed=transferred)
                current_time = time.time()
                if current_time - last_update_time >= 1.0:
                    elapsed = current_time - last_update_time
                    bytes_since_last = transferred - last_bytes
                    speed_mbps = (bytes_since_last / 1024 / 1024) / elapsed
                    progress.update(task, speed=speed_mbps)
                    last_update_time = current_time
                    last_bytes = transferred

            sftp.put(image_path, remote_path, callback=update_progress)
            sftp.close()
        # Start the VM
        click.echo(f"Starting VM {vm_id}...")
        stdin, stdout, stderr = client.exec_command(f"qm start {vm_id}")
        _ = stdout.channel.recv_exit_status()
        if verbose:
            click.echo(f"[VERBOSE] Ran: qm start {vm_id}")
            click.echo(f"[VERBOSE] stdout: {stdout.read().decode('utf-8')}")
            click.echo(f"[VERBOSE] stderr: {stderr.read().decode('utf-8')}")
        client.close()
        click.echo("VM deployment complete")
        return True
    except Exception as e:
        click.echo(f"Error during SSH operations: {str(e)}")
        return False


def parse_disk_size(size_str):
    """Parse disk size string with optional M/G suffix and return size in MB as int."""
    size_str = str(size_str).strip().upper()
    if size_str.endswith("G"):
        return int(float(size_str[:-1]) * 1024)
    elif size_str.endswith("M"):
        return int(float(size_str[:-1]))
    else:
        return int(float(size_str))


@click.command()
@click.option("--vm-id", help="VM ID for Proxmox")
@click.option("--vm-host", help="VM host in ssh user@host format")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose logging")
@click.option(
    "--disk-size",
    default="32G",
    show_default=True,
    help="Disk size for the VM image (e.g. 32768, 32G, 4096M)",
)
@click.argument("hostname", required=True)
def main(vm_id, vm_host, verbose, disk_size, hostname):
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
            if verbose:
                click.echo(f"[VERBOSE] Using temp dir: {temp_dir}")
            # Prepare build files
            image_nix_path = prepare_build_files(temp_dir, hostname)
            if verbose:
                click.echo(f"[VERBOSE] image-build.nix path: {image_nix_path}")

            # Build the image
            disk_size_mb = parse_disk_size(disk_size)
            image_path, build_time = build_vm_image_file(
                image_nix_path,
                hostname,
                expected_build_time,
                verbose=verbose,
                disk_size=disk_size_mb,
            )

        # Save the build time for future runs
        settings["expected_build_time"] = build_time * 1.1
        save_settings(settings)

        click.echo(f"Image built successfully in {build_time:.1f}s: {image_path}")

        # If VM ID and host are specified, deploy the image
        if vm_id and vm_host:
            if not deploy_to_proxmox(image_path, vm_id, vm_host, verbose=verbose):
                return 1
        else:
            click.echo("VM ID and host not specified, skipping deployment")

        return 0

    except Exception as e:
        click.echo(f"Error: {str(e)}")
        return 1


if __name__ == "__main__":
    main()
