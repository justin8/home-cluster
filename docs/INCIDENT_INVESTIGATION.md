# Incident Investigation Runbook

This runbook guides automated agents and human operators investigating alerts triggered by **Gatus** health checks.

---

## 1. Webhook Payload Context

When an endpoint fails consecutive health checks (default threshold: 3 failures), Gatus dispatches a webhook to T3 Code containing:

- **`service`**: Name of the monitored endpoint.
- **`group`**: Domain / category group (e.g., Core Services, Media Apps, Argo CD Applications, Infrastructure).
- **`url`**: The target URL, IP, or probe target.
- **`description`**: Human-readable explanation of what this probe checks.
- **`errors`**: The specific condition failure(s) (e.g., `[STATUS] == 200`, `[BODY] == OK`, timeout, etc.).

Alerts are only sent when an issue is **triggered** (not on resolution). The investigating agent is responsible for diagnosing, mitigating/fixing the issue, and polling until the service is confirmed healthy.

---

## 2. Investigation Sequence

### Phase 1: Check In-Flight Activity

Before modifying any configuration or restarting resources:

1. **Check Active Agent Threads**:
   - Verify whether other agent instances are currently running or making changes in this repository.
   - Run `git status` and check active worktrees (`git worktree list`).
2. **Pull and Inspect Git History**:
   - Run `git pull origin main` to ensure your working tree is synchronized with remote `main`.
   - Run `git log -n 5` to inspect recent commits.
   - Check if a commit deployed within the last 15–30 minutes touched the failing component, Helm values, or cluster secrets. If so, inspect `git show <commit>` for potential regressions.

### Phase 2: Targeted Diagnosis by Alert Type

Use the `description`, `service`, and `group` from the alert payload to target the diagnosis directly:

#### A. Argo CD Application Health Checks

- **Symptoms**: Alert indicates `[BODY] == Healthy` or `[BODY] == Synced` failed on `/api/v1/applications/<app>`.
- **Diagnostic Steps**:
  1. Inspect the application state:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get application -n argocd <app-name> -o yaml
     ```
  2. Check the namespace where the app deploys:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get pods -n <target-namespace>
     ```
  3. If pods are in `CrashLoopBackOff`, `ImagePullBackOff`, or `Pending`, inspect logs and events:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig logs -n <target-namespace> deployment/<app-name> --tail=50
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig describe pod -n <target-namespace> <pod-name>
     ```
  4. Check if Longhorn volumes, PVCs, or Secrets are missing or unattached:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get pvc -n <target-namespace>
     ```

#### B. Public Ingress / Web UI Checks

- **Symptoms**: Alert indicates `[STATUS] == 200` or `[CERTIFICATE_EXPIRATION] > 48h` failed for an external HTTPS domain.
- **Diagnostic Steps**:
  1. Test direct HTTP response with curl:
     ```bash
     curl -Iv <url>
     ```
  2. Check Pomerium proxy ingress and routes:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get pods -n pomerium
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get ingress -A
     ```
  3. Check TLS certificate validity:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get certificate -A
     ```
  4. Verify Cilium network policies allow ingress from Pomerium to the target pod (`CiliumNetworkPolicy`).

#### C. Physical Infrastructure & Node Checks

- **Symptoms**: ICMP ping fails to nodes (`192.168.5.11`, `192.168.5.12`, `192.168.5.13`) or external DNS (`1.1.1.1`, `8.8.8.8`).
- **Diagnostic Steps**:
  1. Check Kubernetes node status:
     ```bash
     kubectl --kubeconfig=/home/justin/src/home-cluster/talos/clusterconfig/kubeconfig get nodes -o wide
     ```
  2. Check Talos node health if nodes are `NotReady`:\
     ```bash
     talosctl --talosconfig=/home/justin/src/home-cluster/talos/clusterconfig/talosconfig -n <node-ip> health
     ```

---

## 3. Applying Fixes and Repository Rules

- **Direct Push Only**: In this repository, **never create pull requests**. All fixes must be committed and pushed directly to `main`:
  ```bash
  git push origin HEAD:main
  ```
- **Declarative GitOps**: Prefer updating manifests and Helm values over ad-hoc manual imperative changes so that Argo CD does not overwrite changes.

---

## 4. Verification and Polling for Success

Do not conclude the investigation until the failing check is verified resolved:

1. **Poll the Target Service**:
   - Query the failing endpoint or check directly every 30 seconds until it returns the expected healthy status (e.g. `HTTP 200`, `Healthy`, or ICMP ping success).
   - Alternatively, check the Gatus endpoint status API:
     ```bash
     curl -s http://192.168.5.178:8080/api/v1/endpoints/<group>_<service>/statuses | jq '.[-1]'
     ```
2. **Wrap Up**:
   - Once success is confirmed across consecutive checks, summarize the root cause and resolution in your report and conclude your turn.
