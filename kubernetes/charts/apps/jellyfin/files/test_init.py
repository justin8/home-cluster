#!/usr/bin/env python3
"""
Unit tests for Jellyfin initialization script (init.py).
Can be run locally with:
    direnv exec . python3 -m unittest discover -s kubernetes/charts/apps/jellyfin/files -p "test_*.py"
"""

import io
import shutil
import tempfile
import unittest
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

# Import functions under test
import init


class TestJellyfinInit(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.base_dir = Path(self.test_dir) / "config"
        self.config_dir = self.base_dir / "config"
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.plugins_dir = self.base_dir / "plugins"
        self.plugins_dir.mkdir(parents=True, exist_ok=True)
        self.plugin_configs_dir = self.plugins_dir / "configurations"
        self.plugin_configs_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    def test_ensure_plugin_repositories_fresh_system_xml(self):
        """Test adding repos to a fresh system.xml with only default repo."""
        system_file = self.config_dir / "system.xml"
        system_file.write_text(
            """<?xml version="1.0" encoding="utf-8"?>
<ServerConfiguration>
  <PluginRepositories>
    <RepositoryInfo>
      <Name>Jellyfin Stable</Name>
      <Url>https://repo.jellyfin.org/files/plugin/manifest.json</Url>
      <Enabled>true</Enabled>
    </RepositoryInfo>
  </PluginRepositories>
</ServerConfiguration>
""",
            encoding="utf-8",
        )

        repos = [
            ("Jellyfin SSO", "https://sso.test/manifest.json"),
            ("gRPC-ffmpeg", "https://grpc.test/manifest.json"),
        ]

        # First run: should modify and add both
        modified = init.ensure_plugin_repositories(system_file, repos)
        self.assertTrue(modified)

        tree = ET.parse(system_file)
        urls = [r.findtext("Url") for r in tree.findall(".//RepositoryInfo")]
        self.assertIn("https://sso.test/manifest.json", urls)
        self.assertIn("https://grpc.test/manifest.json", urls)
        self.assertEqual(len(urls), 3)

        # Second run: idempotent, should not duplicate
        modified_again = init.ensure_plugin_repositories(system_file, repos)
        self.assertFalse(modified_again)
        tree = ET.parse(system_file)
        urls_after = [r.findtext("Url") for r in tree.findall(".//RepositoryInfo")]
        self.assertEqual(len(urls_after), 3)

    def test_ensure_plugin_repositories_missing_system_xml(self):
        """Test graceful no-op if system.xml doesn't exist yet."""
        system_file = self.config_dir / "system.xml"
        repos = [("Jellyfin SSO", "https://sso.test/manifest.json")]
        modified = init.ensure_plugin_repositories(system_file, repos)
        self.assertFalse(modified)

    def test_provision_sso_config_option_2(self):
        """Test SSO configuration is created if missing, preserved if present."""
        sso_file = self.plugin_configs_dir / "SSO-Auth.xml"
        # 1. Missing: should create
        created = init.provision_sso_config(
            sso_file,
            issuer="https://pocketid.example.com",
            client_id="my-client-id",
            client_secret="my-client-secret",
        )
        self.assertTrue(created)
        self.assertTrue(sso_file.is_file())
        content = sso_file.read_text(encoding="utf-8")
        self.assertIn("<OidEndpoint>https://pocketid.example.com/.well-known/openid-configuration</OidEndpoint>", content)
        self.assertIn("<OidClientId>my-client-id</OidClientId>", content)
        self.assertIn("<DisablePushedAuthorization>true</DisablePushedAuthorization>", content)

        # 2. Existing: should preserve (Option 2)
        sso_file.write_text("<CustomUserModifications />", encoding="utf-8")
        created_again = init.provision_sso_config(
            sso_file,
            issuer="https://different.com",
            client_id="diff-id",
            client_secret="diff-secret",
        )
        self.assertFalse(created_again)
        self.assertEqual(sso_file.read_text(encoding="utf-8"), "<CustomUserModifications />")

    def test_provision_grpc_config_option_2(self):
        """Test gRPC configuration is created if missing, preserved if present."""
        grpc_file = self.plugin_configs_dir / "Jellyfin.Plugin.GrpcFfmpeg.xml"
        created = init.provision_grpc_config(
            grpc_file,
            token="secret-token-123",
            host="ffmpeg-worker",
            port=50051,
        )
        self.assertTrue(created)
        self.assertTrue(grpc_file.is_file())
        content = grpc_file.read_text(encoding="utf-8")
        self.assertIn("<GrpcHost>ffmpeg-worker</GrpcHost>", content)
        self.assertIn("<GrpcPort>50051</GrpcPort>", content)
        self.assertIn("<AuthToken>secret-token-123</AuthToken>", content)
        self.assertIn("<Enabled>false</Enabled>", content)

        # Preserved if exists
        grpc_file.write_text("<UserCustomConfig />", encoding="utf-8")
        created_again = init.provision_grpc_config(grpc_file, token="new-token")
        self.assertFalse(created_again)
        self.assertEqual(grpc_file.read_text(encoding="utf-8"), "<UserCustomConfig />")

    @patch("urllib.request.urlopen")
    def test_install_plugin_if_missing(self, mock_urlopen):
        """Test downloading and extracting plugin if missing, skipping if exists."""
        # Create a mock zip in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("test.dll", b"fake binary dll data")
            zf.writestr("meta.json", b'{"name": "test"}')
        zip_bytes = zip_buffer.getvalue()

        # Mock the HTTP response
        mock_resp = MagicMock()
        mock_resp.read.side_effect = [zip_bytes, b""]
        mock_urlopen.return_value.__enter__.return_value = io.BytesIO(zip_bytes)

        # First install: missing, should download and unpack
        installed = init.install_plugin_if_missing(
            plugins_dir=self.plugins_dir,
            glob_pattern="TestPlugin*",
            target_dir_name="TestPlugin_1.0.0",
            download_url="https://example.com/test.zip",
            plugin_name="TestPlugin",
        )
        self.assertTrue(installed)
        target_dir = self.plugins_dir / "TestPlugin_1.0.0"
        self.assertTrue((target_dir / "test.dll").is_file())
        self.assertTrue((target_dir / "meta.json").is_file())

        # Second run: directory already matches "TestPlugin*", should skip
        mock_urlopen.reset_mock()
        installed_again = init.install_plugin_if_missing(
            plugins_dir=self.plugins_dir,
            glob_pattern="TestPlugin*",
            target_dir_name="TestPlugin_1.0.0",
            download_url="https://example.com/test.zip",
            plugin_name="TestPlugin",
        )
        self.assertFalse(installed_again)
        mock_urlopen.assert_not_called()

    def test_configure_branding_create_and_update(self):
        """Test creating branding.xml and updating existing branding.xml with @import."""
        branding_file = self.config_dir / "branding.xml"
        css_url = "@import url('https://cdn.jsdelivr.net/gh/AumGupta/abyss-jellyfin@main/abyss.css');"

        # 1. Missing: create with Pocket ID disclaimer and Abyss CSS
        created = init.configure_branding(branding_file, css_url)
        self.assertTrue(created)
        self.assertTrue(branding_file.is_file())

        tree = ET.parse(branding_file)
        self.assertIn("Pocket ID", tree.findtext("LoginDisclaimer"))
        self.assertIn(css_url, tree.findtext("CustomCss"))

        # 2. Existing branding without Abyss @import: updates CustomCss
        custom_xml = """<?xml version="1.0" encoding="utf-8"?>
<BrandingOptions>
  <CustomCss>body { font-size: 14px; }</CustomCss>
</BrandingOptions>
"""
        branding_file.write_text(custom_xml, encoding="utf-8")
        updated = init.configure_branding(branding_file, css_url)
        self.assertTrue(updated)

        tree = ET.parse(branding_file)
        new_css = tree.findtext("CustomCss")
        self.assertTrue(new_css.startswith(css_url))
        self.assertIn("body { font-size: 14px; }", new_css)

        # 3. Existing branding with Abyss @import already present: preserves without changes
        no_change = init.configure_branding(branding_file, css_url)
        self.assertFalse(no_change)

    def test_setup_web_override(self):
        """Test web asset copying and script tag injection into index.html."""
        source_web = Path(self.test_dir) / "source_web"
        source_web.mkdir()
        (source_web / "index.html").write_text("<!DOCTYPE html><html><head></head><body></body></html>", encoding="utf-8")

        override_web = Path(self.test_dir) / "override_web"
        override_web.mkdir()

        with patch("urllib.request.urlopen") as mock_url:
            mock_url.return_value.__enter__.return_value = io.BytesIO(b"/* spotlight mock */")
            init.setup_web_override(
                source_web_dir=source_web,
                override_web_dir=override_web,
                raw_base_url="https://example.com/abyss",
            )

        index_html = (override_web / "index.html").read_text(encoding="utf-8")
        self.assertIn('<script src="ui/abyss-defaults.js"></script>', index_html)
        self.assertIn('<script src="ui/spotlight-loader.js" data-abyss-spotlight></script>', index_html)
        self.assertTrue((override_web / "ui" / "abyss-defaults.js").is_file())


if __name__ == "__main__":
    unittest.main()
