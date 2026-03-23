# Sealed Secrets Management

[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) is used to encrypt Kubernetes Secrets into a `SealedSecret` resource, which is safe to store in a public or private Git repository.

## Configuration

The controller is configured in `kubernetes/charts/sealed-secrets/values.yaml`.

In this cluster, automatic key renewal is **disabled** and the key validity is set to **100 years** to simplify long-term management and disaster recovery.

- `keyrenewperiod: "0"` (Disabled)
- `keyttl: "876000h00m00s"` (100 Years)

## Backup Sealing Key

The sealing keys are stored as standard Kubernetes Secrets in the `kube-system` namespace. It is critical to backup these keys to decrypt your `SealedSecrets` if the cluster is destroyed.

1. **Identify and Export Keys:**
   Run the following command to export all active sealing keys to a file:

   ```bash
   kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml > sealed-secrets-key.yaml
   ```

2. **Secure the Backup:**
   Store `sealed-secrets-key.yaml` in a secure location (e.g., a password manager or encrypted vault). This file contains the **private keys** required to decrypt your secrets.

## Restore Sealing Key

To restore the keys during a new cluster creation or after a disaster:

1. **Apply the Backup:**
   Apply the saved keys to the cluster _before_ the controller starts, or replace the existing ones if the controller is already running:

   ```bash
   kubectl apply -f sealed-secrets-key.yaml
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
