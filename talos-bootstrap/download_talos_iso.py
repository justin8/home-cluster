#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "click",
#     "requests",
#     "rich",
# ]
# ///

import click
import requests
import os
from rich.console import Console
from rich.progress import Progress, BarColumn, TimeRemainingColumn, TransferSpeedColumn, FileSizeColumn

@click.command()
@click.option('--version', default='1.10.4', help='Talos version')
@click.option('--architecture', default='amd64', help='Architecture')
@click.option('--format', default='iso', type=click.Choice(['iso', 'raw', 'qcow2']), help='Image format (iso, raw, qcow2)')
def download_talos_iso(version, architecture, format):
    '''Downloads the Talos image.'''
    console = Console()

    console.print(f"[cyan]Downloading Talos image with version: {version}, architecture: {architecture}, format: {format}[/cyan]")

    try:
        with open(os.path.join(os.path.dirname(__file__), 'talos.yml'), 'r') as f:
            talos_yaml = f.read()
    except FileNotFoundError:
        console.print_exception()
        return


    try:
        response = requests.post('https://factory.talos.dev/schematics', data=talos_yaml)
        response.raise_for_status()
        data = response.json()
        image_id = data['id']
    except requests.exceptions.RequestException as e:
        console.print_exception()
        return
    except KeyError:
        console.print("[red]Error: 'id' not found in the response.[/red]")
        return

    format_map = {
        'iso': 'iso',
        'raw': 'raw.zst',
        'qcow2': 'qcow2'
    }

    ext = format_map[format]

    image_url = f'https://factory.talos.dev/image/{image_id}/v{version}/metal-{architecture}.{ext}'
    filename = f'talos-{version}-{architecture}.{ext}'

    try:
        with requests.get(image_url, stream=True) as r:
            r.raise_for_status()
            total_size = int(r.headers.get('content-length', 0))
            chunk_size = 8192

            with Progress(
                "[progress.description]{task.description}",
                BarColumn(),
                "[progress.percentage]{task.percentage:>3.1f}%",
                FileSizeColumn(),
                TransferSpeedColumn(),
                TimeRemainingColumn(),
                console=console
            ) as progress:
                task_id = progress.add_task("[cyan]Downloading...", total=total_size)

                with open(filename, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=chunk_size):
                        if chunk:
                            f.write(chunk)
                            progress.update(task_id, advance=len(chunk))

        console.print(f"[green]Downloaded Talos image to {filename}[/green]")

    except requests.exceptions.RequestException as e:
        console.print_exception()
        return
    except Exception as e:
        console.print_exception()
        return

if __name__ == '__main__':
    download_talos_iso()
