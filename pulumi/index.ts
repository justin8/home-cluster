import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";

import { PRIVATE_INGRESS_CLASS, PUBLIC_INGRESS_CLASS } from "./src/constants";
import {
  Auth,
  CertManager,
  CNPGOperator,
  Dns,
  IngressControllers,
  Longhorn,
  MetalLB,
  NFSCSI,
  SharedSecrets,
} from "./src/core-services";

const config = new pulumi.Config();

// Initialize core services and load applications
const coreServices = initializeCoreServices();
loadApplications(coreServices);

/**
 * Initializes all core services required by applications
 *
 * @returns Array of initialized core service resources
 */
function initializeCoreServices(): pulumi.Resource[] {
  const sharedSecrets = new SharedSecrets("secrets");

  const metallb = new MetalLB("metallb", {
    addresses: [config.require("ip_address_pool")],
  });

  const certManager = new CertManager(
    "cert-manager",
    {
      email: config.require("cert_manager_email"),
      cloudflareSecret: sharedSecrets.cloudflareSecret,
      domain: config.require("domain"),
    },
    {
      dependsOn: [sharedSecrets],
    }
  );

  const nfsCsi = new NFSCSI("nfs-csi");

  const ingressControllers = new IngressControllers(
    "ingress-controllers",
    {},
    {
      dependsOn: [metallb],
    }
  );

  const longhorn = new Longhorn(
    "longhorn",
    {},
    {
      dependsOn: [ingressControllers],
    }
  );

  const dns = new Dns(
    "dns",
    {
      publicIngressClass: PUBLIC_INGRESS_CLASS,
      privateIngressClass: PRIVATE_INGRESS_CLASS,
      cloudflareSecret: sharedSecrets.cloudflareSecret,
    },
    { dependsOn: [longhorn] }
  );

  const cnpgOperator = new CNPGOperator("cnpg-operator", { dependsOn: [longhorn] });

  const auth = new Auth("auth", {}, { dependsOn: [sharedSecrets] });

  // Return array of all core services
  return [
    metallb,
    sharedSecrets,
    certManager,
    nfsCsi,
    ingressControllers,
    longhorn,
    cnpgOperator,
    dns,
    auth,
  ];
}

/**
 * Dynamically loads and instantiates all applications from the applications directory
 *
 * @param dependencies - Array of resources that applications depend on
 * @returns Array of instantiated application resources
 */
function loadApplications(dependencies: pulumi.Resource[]): pulumi.Resource[] {
  const applicationsDir = path.join(__dirname, "src", "applications");
  const instantiatedApps: pulumi.Resource[] = [];

  try {
    // Get all directories in the applications folder
    const applicationFolders = fs
      .readdirSync(applicationsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name !== "node_modules")
      .map(dirent => dirent.name);

    // Import and instantiate each application
    for (const appFolder of applicationFolders) {
      try {
        // Skip the index.ts file itself
        if (appFolder === "index.ts") continue;

        // Dynamically import the application module
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const appModule = require(`./src/applications/${appFolder}`);

        // Convert folder name from kebab-case to PascalCase for the class name
        const className = appFolder
          .split("-")
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join("");

        const AppClass = appModule[className];

        if (AppClass) {
          // Instantiate the application with dependencies
          const app = new AppClass(appFolder, {
            dependsOn: dependencies,
          });

          instantiatedApps.push(app);
          console.log(`Successfully loaded application: ${appFolder}`);
        } else {
          console.warn(`Could not find class ${className} in module ${appFolder}`);
        }
      } catch (error) {
        console.error(`Error loading application ${appFolder}:`, error);
      }
    }
  } catch (error) {
    console.error("Error reading applications directory:", error);
  }

  return instantiatedApps;
}
