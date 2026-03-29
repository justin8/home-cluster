# Sealed Secrets Management

[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) is used to encrypt Kubernetes Secrets into a `SealedSecret` resource, which is safe to store in a public or private Git repository.

## Configuration

The controller is configured in `kubernetes/charts/sealed-secrets/values.yaml`.

In this cluster, automatic key renewal is **disabled** and the key validity is set to **100 years** to simplify long-term management and disaster recovery.

- `keyrenewperiod: "0"` (Disabled)
- `keyttl: "876000h00m00s"` (100 Years)

## Creating a New Sealed Secret

You can create a `SealedSecret` using `kubeseal` directly. It is already configured to use the cluster's public key.

```bash
# 1. Create a temporary local secret (dry-run)
kubectl create secret generic my-secret \
  --from-literal=username=admin \
  --from-literal=password=password123 \
  --namespace my-namespace \
  --dry-run=client -o yaml > my-secret.yaml

# 2. Seal it
kubeseal --controller-name=sealed-secrets-controller --controller-namespace=kube-system < my-secret.yaml > my-sealed-secret.yaml

# 3. Clean up the cleartext secret
rm my-secret.yaml
```

### Scopes and Metadata

By default, `kubeseal` uses **strict** scope. This means the `SealedSecret` **must** have the same name and namespace as the original secret.

- **Strict (Default):** Tied to name and namespace.
- **Namespace-wide:** Tied only to the namespace. Use `--scope namespace-wide`.
- **Cluster-wide:** Can be unsealed in any namespace. Use `--scope cluster-wide`.

**Warning:** If you change the namespace or name of a `SealedSecret` in Git without re-sealing it with the correct scope, the controller will fail to decrypt it.

## Backup Sealing Key

The sealing keys are stored as standard Kubernetes Secrets in the `kube-system` namespace. It is critical to backup these keys to decrypt your `SealedSecrets` if the cluster is destroyed.

1. **Identify and Export Keys:**
   Run the following command to export all active sealing keys to a file:

   ```bash
   kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml > sealed-secrets-key.yaml
   ```

2. **Encrypt and Store the Backup:**
   Encrypt the key file with sops before storing it:

   ```bash
   sops --encrypt sealed-secrets-key.yaml > sealed-secrets-key.sops.yaml
   ```

   Store `sealed-secrets-key.sops.yaml` in a secure location (e.g., a password manager or encrypted vault). This file contains the **private keys** required to decrypt your secrets.

## Restore Sealing Key

To restore the keys during a new cluster creation or after a disaster:

1. **Decrypt and Apply the Backup:**
   Decrypt the key file with sops, then apply it to the cluster _before_ the controller starts, or replace the existing ones if the controller is already running:

   ```bash
   sops --decrypt sealed-secrets-key.sops.yaml | kubectl apply -f -
   ```

2. **Restart the Controller:**
   Delete the controller pod to force it to pick up the restored keys:

   ```bash
   kubectl delete pod -n kube-system -l app.kubernetes.io/name=sealed-secrets
   ```

## Offline Decryption (Recovery)

If the cluster is unavailable, you can decrypt secrets offline using the backup file and `kubeseal`:

```bash
kubeseal --recovery-unseal --recovery-private-key sealed-secrets-key.yaml < sealed-secret.yaml
```
