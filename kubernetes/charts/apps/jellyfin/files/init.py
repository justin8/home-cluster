#!/usr/bin/env python3
"""
Jellyfin Initialization Script
Handles:
  1. Plugin repositories in system.xml
  2. Plugin downloads & extraction (Option 2: install only if missing)
  3. Plugin configurations (SSO-Auth.xml, Jellyfin.Plugin.GrpcFfmpeg.xml)
  4. Branding configuration (branding.xml)
  5. Web overrides & Spotlight injection (Abyss theme)
"""

import os
import shutil
import sys
import traceback
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def log(msg: str) -> None:
    print(f"[init] {msg}", flush=True)


def download_file(url: str, dest: Path, timeout: int = 20) -> bool:
    """Downloads a URL to a local path with User-Agent and timeout."""
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Jellyfin-Init/1.0"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out_file:
            shutil.copyfileobj(resp, out_file)
        return True
    except Exception as e:
        log(f"Warning: Failed to download {url}: {e}")
        if dest.exists():
            dest.unlink(missing_ok=True)
        return False


def ensure_plugin_repositories(system_file: Path, repositories: list[tuple[str, str]]) -> bool:
    """
    Ensures that each (name, url) repository is present in system.xml.
    Returns True if system.xml was modified.
    """
    if not system_file.is_file():
        log(f"{system_file} not found; skipping repository registration.")
        return False

    try:
        tree = ET.parse(system_file)
        root = tree.getroot()
    except Exception as e:
        log(f"Warning: Failed to parse {system_file}: {e}")
        return False

    repos_elem = root.find("PluginRepositories")
    if repos_elem is None:
        repos_elem = ET.SubElement(root, "PluginRepositories")

    existing_urls = {
        r.findtext("Url", "").strip()
        for r in repos_elem.findall("RepositoryInfo")
    }

    modified = False
    for name, url in repositories:
        if url.strip() not in existing_urls:
            log(f"Adding repository '{name}' ({url}) to system.xml...")
            repo_info = ET.SubElement(repos_elem, "RepositoryInfo")
            ET.SubElement(repo_info, "Name").text = name
            ET.SubElement(repo_info, "Url").text = url
            ET.SubElement(repo_info, "Enabled").text = "true"
            existing_urls.add(url.strip())
            modified = True
        else:
            log(f"Repository '{name}' already present in system.xml.")

    if modified:
        ET.indent(tree, space="  ")
        tree.write(system_file, encoding="utf-8", xml_declaration=True)
        log(f"Updated {system_file}")

    return modified


def install_plugin_if_missing(
    plugins_dir: Path,
    glob_pattern: str,
    target_dir_name: str,
    download_url: str,
    plugin_name: str,
) -> bool:
    """
    Installs a plugin zip into target_dir_name under plugins_dir if no directory
    matching glob_pattern exists.
    """
    plugins_dir.mkdir(parents=True, exist_ok=True)
    matches = list(plugins_dir.glob(glob_pattern))
    if matches:
        log(f"Plugin '{plugin_name}' already installed ({matches[0].name}). Skipping.")
        return False

    target_dir = plugins_dir / target_dir_name
    log(f"Plugin '{plugin_name}' missing. Downloading from {download_url}...")
    temp_zip = plugins_dir / f".tmp_{target_dir_name}.zip"

    try:
        if not download_file(download_url, temp_zip, timeout=30):
            log(f"ERROR: Could not download '{plugin_name}'")
            return False

        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(temp_zip, "r") as zf:
            zf.extractall(target_dir)

        log(f"Successfully installed '{plugin_name}' into {target_dir}")
        return True
    except Exception as e:
        log(f"ERROR: Failed to extract plugin '{plugin_name}': {e}")
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        return False
    finally:
        if temp_zip.exists():
            temp_zip.unlink(missing_ok=True)


def provision_sso_config(config_file: Path, issuer: str, client_id: str, client_secret: str) -> bool:
    """
    Creates SSO-Auth.xml if missing (Option 2: install only if missing).
    """
    if config_file.is_file():
        log(f"{config_file} already exists, preserving existing configuration.")
        return False

    config_file.parent.mkdir(parents=True, exist_ok=True)
    log(f"Writing SSO configuration to {config_file}...")

    xml_content = f"""<?xml version="1.0" encoding="utf-8"?>
<PluginConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <SamlConfigs />
  <OidConfigs>
    <item>
      <key>
        <string>pocketid</string>
      </key>
      <value>
        <PluginConfiguration>
          <OidEndpoint>{issuer}/.well-known/openid-configuration</OidEndpoint>
          <OidClientId>{client_id}</OidClientId>
          <OidSecret>{client_secret}</OidSecret>
          <Enabled>true</Enabled>
          <EnableAuthorization>true</EnableAuthorization>
          <EnableAllFolders>true</EnableAllFolders>
          <SchemeOverride>https</SchemeOverride>
          <DisablePushedAuthorization>true</DisablePushedAuthorization>
          <RoleClaim>groups</RoleClaim>
          <AdminRoles>
            <string>admin</string>
            <string>Admin</string>
          </AdminRoles>
          <PreserveAdminPermissions>true</PreserveAdminPermissions>
          <OidScopes>
            <string>openid</string>
            <string>profile</string>
            <string>email</string>
            <string>groups</string>
          </OidScopes>
        </PluginConfiguration>
      </value>
    </item>
  </OidConfigs>
</PluginConfiguration>
"""
    config_file.write_text(xml_content, encoding="utf-8")
    log(f"Successfully created {config_file}")
    return True


def provision_grpc_config(config_file: Path, token: str, host: str = "jellyfin-ffmpeg-worker", port: int = 50051) -> bool:
    """
    Creates Jellyfin.Plugin.GrpcFfmpeg.xml if missing (Option 2).
    """
    if config_file.is_file():
        log(f"{config_file} already exists, preserving existing configuration.")
        return False

    config_file.parent.mkdir(parents=True, exist_ok=True)
    log(f"Writing gRPC-ffmpeg configuration to {config_file}...")

    xml_content = f"""<?xml version="1.0" encoding="utf-8"?>
<PluginConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Enabled>false</Enabled>
  <GrpcHost>{host}</GrpcHost>
  <GrpcPort>{port}</GrpcPort>
  <UseSsl>false</UseSsl>
  <AuthToken>{token}</AuthToken>
  <RunCommandsLocally>true</RunCommandsLocally>
  <Retries>2</Retries>
  <ConnectTimeout>5</ConnectTimeout>
</PluginConfiguration>
"""
    config_file.write_text(xml_content, encoding="utf-8")
    log(f"Successfully created {config_file}")
    return True


def configure_branding(branding_file: Path, css_import_url: str) -> bool:
    """
    Ensures branding.xml exists with Pocket ID login disclaimer and Abyss theme @import.
    If branding.xml already exists, ensures the @import is present in CustomCss.
    """
    branding_file.parent.mkdir(parents=True, exist_ok=True)

    default_disclaimer = (
        '<form action="/sso/OID/start/pocketid" method="get" style="display: block; width: 100%; margin: 0; padding: 0;">\n'
        '  <button type="submit" style="display: block; width: 100%; box-sizing: border-box; background-color: #00a4dc; color: #000000; '
        'font-family: inherit; font-size: inherit; font-weight: 600; line-height: 1.35; border: 0; border-radius: 0.2em; '
        'padding: 0.9em 1em; margin: 0.25em 0; text-align: center; cursor: pointer;">\n'
        '    <span style="color: #000000; font-weight: 600;">Sign in with Pocket ID</span>\n'
        '  </button>\n'
        '</form>'
    )

    disclaimer_css = (
        f"{css_import_url}\n\n"
        ".loginDisclaimerContainer {\n"
        "  display: block !important;\n"
        "  width: 100% !important;\n"
        "  margin-top: 1.5em !important;\n"
        "}\n\n"
        ".loginDisclaimer {\n"
        "  display: block !important;\n"
        "  width: 100% !important;\n"
        "  max-width: 100% !important;\n"
        "  margin: 0 !important;\n"
        "}\n\n"
        ".loginDisclaimer button:hover {\n"
        "  background-color: #00729a !important;\n"
        "}"
    )

    if not branding_file.is_file():
        log(f"{branding_file} missing. Creating with Pocket ID button and Abyss theme...")
        root = ET.Element(
            "BrandingOptions",
            {
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                "xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
            },
        )
        ET.SubElement(root, "LoginDisclaimer").text = default_disclaimer
        ET.SubElement(root, "CustomCss").text = disclaimer_css
        ET.SubElement(root, "SplashscreenEnabled").text = "true"
        ET.SubElement(root, "SplashscreenLocation").text = "/config/data/splashscreen-upload.jpg"

        ET.indent(root, space="  ")
        tree = ET.ElementTree(root)
        tree.write(branding_file, encoding="utf-8", xml_declaration=True)
        log(f"Created {branding_file}")
        return True

    # branding.xml already exists, check if css_import_url is in CustomCss
    try:
        tree = ET.parse(branding_file)
        root = tree.getroot()
        custom_css = root.find("CustomCss")
        if custom_css is None:
            custom_css = ET.SubElement(root, "CustomCss")
            custom_css.text = ""

        current_css = custom_css.text or ""
        if "abyss-jellyfin" not in current_css and css_import_url not in current_css:
            log(f"Adding Abyss theme import to CustomCss in {branding_file}...")
            custom_css.text = f"{css_import_url}\n\n{current_css}".strip()
            ET.indent(tree, space="  ")
            tree.write(branding_file, encoding="utf-8", xml_declaration=True)
            log(f"Updated {branding_file}")
            return True
        else:
            log(f"Abyss theme already present in {branding_file}, preserving.")
            return False
    except Exception as e:
        log(f"Warning: Failed to update {branding_file}: {e}")
        return False


def setup_web_override(
    source_web_dir: Path,
    override_web_dir: Path,
    raw_base_url: str,
) -> None:
    """
    Copies base web assets to override_web_dir, downloads spotlight assets,
    configures abyss-defaults.js, and injects script tags into index.html.
    """
    if not override_web_dir.is_dir():
        log(f"{override_web_dir} is not mounted; skipping web override.")
        return

    if source_web_dir.is_dir() and not (override_web_dir / "index.html").exists():
        log(f"Copying base web assets from {source_web_dir} to {override_web_dir}...")
        try:
            shutil.copytree(source_web_dir, override_web_dir, copy_function=shutil.copy, dirs_exist_ok=True)
        except Exception as e:
            log(f"Warning during copytree: {e}")

    ui_dir = override_web_dir / "ui"
    ui_dir.mkdir(parents=True, exist_ok=True)
    index_file = override_web_dir / "index.html"

    # 1. Spotlight assets
    spotlight_files = ["spotlight.html", "spotlight.css", "spotlight-loader.js"]
    for fname in spotlight_files:
        dest = ui_dir / fname
        if not dest.is_file():
            url = f"{raw_base_url}/scripts/spotlight/{fname}"
            log(f"Downloading {fname} from {url}...")
            download_file(url, dest, timeout=15)

    # 2. Defaults script
    defaults_file = ui_dir / "abyss-defaults.js"
    if not defaults_file.is_file():
        defaults_js = """(function () {
  try {
    var originalGetItem = Storage.prototype.getItem;
    var defaults = {
      'enableBackdrops': 'true',
      'appTheme': 'dark',
      'homesection0': 'resume',
      'homesection1': 'nextup',
      'homesection2': 'smalllibrarytiles',
      'homesection3': 'latestmedia'
    };
    Storage.prototype.getItem = function (key) {
      var val = originalGetItem.apply(this, arguments);
      if (val !== null && val !== undefined) return val;
      if (this === window.localStorage && typeof key === 'string') {
        for (var suffix in defaults) {
          if (Object.prototype.hasOwnProperty.call(defaults, suffix)) {
            if (key === suffix || key.endsWith('-' + suffix)) return defaults[suffix];
          }
        }
      }
      return val;
    };
  } catch (e) {
    console.warn('[abyss-defaults] Failed to apply storage defaults:', e);
  }
})();
"""
        defaults_file.write_text(defaults_js, encoding="utf-8")
        log(f"Wrote {defaults_file}")

    if index_file.is_file():
        html = index_file.read_text(encoding="utf-8")
        if "ui/abyss-defaults.js" not in html:
            script_tag = '<script src="ui/abyss-defaults.js"></script>'
            if "</head>" in html:
                html = html.replace("</head>", f"{script_tag}</head>", 1)
            elif "</body>" in html:
                html = html.replace("</body>", f"{script_tag}</body>", 1)
            index_file.write_text(html, encoding="utf-8")
            log("Injected abyss-defaults.js into index.html")

    # 3. Inject spotlight loader
    if index_file.is_file():
        html = index_file.read_text(encoding="utf-8")
        if "data-abyss-spotlight" not in html and "</body>" in html:
            loader_tag = '<script src="ui/spotlight-loader.js" data-abyss-spotlight></script>'
            html = html.replace("</body>", f"{loader_tag}</body>", 1)
            index_file.write_text(html, encoding="utf-8")
            log("Injected Spotlight loader into index.html")


def main() -> None:
    try:
        # Explicit Jellyfin directory layout:
        # /config (root PVC mount)
        #   ├── config/ (system.xml, branding.xml)
        #   └── plugins/ (plugin directories and configurations/)
        data_dir = Path("/config")
        config_dir = data_dir / "config"
        plugins_dir = data_dir / "plugins"
        plugin_configs_dir = plugins_dir / "configurations"

        log("Starting Jellyfin configuration and plugin initialization...")

        # 1. Repositories in system.xml
        repos = [
            ("Jellyfin SSO", "https://raw.githubusercontent.com/k0lin/jellyfin-plugin-sso/manifest-release/manifest.json"),
        ]
        grpc_enabled = os.environ.get("GRPC_ENABLED", "true").lower() == "true"
        if grpc_enabled:
            repos.append(
                ("gRPC-ffmpeg", "https://raw.githubusercontent.com/CrystalNET-org/Jellyfin.Plugin.GrpcFfmpeg/main/manifest.json")
            )
        ensure_plugin_repositories(config_dir / "system.xml", repos)

        # 2. SSO Plugin & Configuration
        install_plugin_if_missing(
            plugins_dir=plugins_dir,
            glob_pattern="SSO*",
            target_dir_name="SSO Authentication_5.1.1",
            download_url="https://github.com/k0lin/jellyfin-plugin-sso/releases/download/v5.1.1/sso-authentication_5.1.1.zip",
            plugin_name="SSO Authentication",
        )
        oidc_issuer = os.environ.get("OIDC_ISSUER", "")
        oidc_client_id = os.environ.get("OIDC_CLIENT_ID", "")
        oidc_client_secret = os.environ.get("OIDC_CLIENT_SECRET", "")
        if oidc_issuer and oidc_client_id:
            provision_sso_config(plugin_configs_dir / "SSO-Auth.xml", oidc_issuer, oidc_client_id, oidc_client_secret)

        # 3. gRPC-ffmpeg Plugin & Configuration
        if grpc_enabled:
            install_plugin_if_missing(
                plugins_dir=plugins_dir,
                glob_pattern="gRPC-ffmpeg*",
                target_dir_name="gRPC-ffmpeg_0.3.2.0",
                download_url="https://github.com/CrystalNET-org/Jellyfin.Plugin.GrpcFfmpeg/releases/download/0.3.2/gRPC-ffmpeg_0.3.2.0.zip",
                plugin_name="gRPC-ffmpeg",
            )
            grpc_token = os.environ.get("VALID_TOKEN", "")
            grpc_host = os.environ.get("GRPC_HOST", "jellyfin-ffmpeg-worker")
            grpc_port = int(os.environ.get("GRPC_PORT", "50051"))
            provision_grpc_config(plugin_configs_dir / "Jellyfin.Plugin.GrpcFfmpeg.xml", grpc_token, grpc_host, grpc_port)

        # 4. Branding & Theme (Abyss Theme is always enabled)
        abyss_repo = "AumGupta/abyss-jellyfin"
        abyss_branch = "main"
        css_url = f"@import url('https://cdn.jsdelivr.net/gh/{abyss_repo}@{abyss_branch}/abyss.css');"

        configure_branding(config_dir / "branding.xml", css_url)

        override_web_dir = Path("/web-override")
        source_web_dir = Path("/jellyfin/jellyfin-web")
        raw_base = f"https://raw.githubusercontent.com/{abyss_repo}/{abyss_branch}"
        setup_web_override(source_web_dir, override_web_dir, raw_base)

        log("Jellyfin initialization complete.")
    except Exception as e:
        log(f"CRITICAL ERROR during initialization: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
