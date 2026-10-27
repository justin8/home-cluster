const fs = require("fs");

const dbPath = "/config/absdatabase.sqlite";
if (!fs.existsSync(dbPath)) {
  console.log(`[init-oidc] Database ${dbPath} does not exist yet. Skipping.`);
  process.exit(0);
}

const sqlite3 = require("/app/node_modules/sqlite3");
const db = new sqlite3.Database(dbPath);

const clientId = process.env.OIDC_CLIENT_ID;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
const issuerUrl = process.env.OIDC_ISSUER_URL;

if (!clientSecret) {
  console.log("[init-oidc] OIDC_CLIENT_SECRET is not set. Skipping.");
  process.exit(0);
}

db.get("SELECT value FROM settings WHERE key='server-settings'", (err, row) => {
  if (err) {
    if (err.message && err.message.includes("no such table")) {
      console.log("[init-oidc] settings table does not exist yet. Skipping.");
      process.exit(0);
    }
    console.error("[init-oidc] Error querying settings table:", err);
    process.exit(1);
  }

  if (!row || !row.value) {
    console.log("[init-oidc] server-settings row not found. Skipping.");
    process.exit(0);
  }

  try {
    const settings = JSON.parse(row.value);
    let changed = false;

    if (clientSecret && settings.authOpenIDClientSecret !== clientSecret) {
      console.log("[init-oidc] Updating authOpenIDClientSecret");
      settings.authOpenIDClientSecret = clientSecret;
      changed = true;
    }
    if (clientId && settings.authOpenIDClientID !== clientId) {
      console.log("[init-oidc] Updating authOpenIDClientID");
      settings.authOpenIDClientID = clientId;
      changed = true;
    }
    if (issuerUrl && settings.authOpenIDIssuerURL !== issuerUrl) {
      console.log("[init-oidc] Updating authOpenIDIssuerURL");
      settings.authOpenIDIssuerURL = issuerUrl;
      changed = true;
    }

    if (changed) {
      db.run(
        "UPDATE settings SET value=? WHERE key='server-settings'",
        [JSON.stringify(settings)],
        updateErr => {
          if (updateErr) {
            console.error("[init-oidc] Failed to update server-settings:", updateErr);
            process.exit(1);
          }
          console.log("[init-oidc] Successfully updated server-settings in SQLite database.");
          db.close();
        }
      );
    } else {
      console.log("[init-oidc] OIDC settings in SQLite database are already up to date.");
      db.close();
    }
  } catch (parseErr) {
    console.error("[init-oidc] Failed to parse server-settings JSON:", parseErr);
    process.exit(1);
  }
});
