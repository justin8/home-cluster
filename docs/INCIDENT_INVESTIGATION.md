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

### Phase 1: Check In-Flight Activity & Maintenance

Before modifying any configuration or restarting resources:

1. **Check for Active Maintenance, OS Upgrades, or Node Reboots**:
   - Check if an upgrade script or maintenance process is running locally:
     ```bash
     pgrep -f "upgrade-talos" || true
     ```
   - Check if any cluster node is currently cordoned (`SchedulingDisabled`) or in a reboot sequence:
     ```bash
     direnv exec . kubectl get nodes
     ```
   - Check if Longhorn storage is actively rebuilding volume replicas due to a node reboot:
     ```bash
     direnv exec . kubectl get volume.longhorn.io -n longhorn-system -o jsonpath='{range .items[*]}{.status.robustness}{"\n"}{end}' 2>/dev/null | grep -c "degraded" || true
     ```
   - **Maintenance Guard Action**:
     - If `upgrade-talos` is running, any node is cordoned/NotReady, or storage is rebuilding after a node reboot, **DO NOT attempt remediation**.
     - This alert is expected transient churn caused by planned node draining, rebooting, or volume reattachment.
     - **Response**: State clearly that an active cluster upgrade or node maintenance is underway, suppress remediation, and exit immediately without modifying workloads or restarting pods.

2. **Check Active Agent Threads**:
   - Verify whether other agent instances are currently running or making changes in this repository.
   - Run `git status` and check active worktrees (`git worktree list`).

3. **Pull and Inspect Git History**:
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
     direnv exec . kubectl get application -n argocd <app-name> -o yaml
     ```
  2. Check the namespace where the app deploys:
     ```bash
     direnv exec . kubectl get pods -n <target-namespace>
     ```
  3. If pods are in `CrashLoopBackOff`, `ImagePullBackOff`, or `Pending`, inspect logs and events:
     ```bash
     direnv exec . kubectl logs -n <target-namespace> deployment/<app-name> --tail=50
     direnv exec . kubectl describe pod -n <target-namespace> <pod-name>
     ```
  4. Check if Longhorn volumes, PVCs, or Secrets are missing or unattached:
     ```bash
     direnv exec . kubectl get pvc -n <target-namespace>
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
     direnv exec . kubectl get pods -n pomerium
     direnv exec . kubectl get ingress -A
     ```
  3. Check TLS certificate validity:
     ```bash
     direnv exec . kubectl get certificate -A
     ```
  4. Verify Cilium network policies allow ingress from Pomerium to the target pod (`CiliumNetworkPolicy`).

#### C. Physical Infrastructure & Node Checks

- **Symptoms**: ICMP ping fails to nodes (`192.168.5.11`, `192.168.5.12`, `192.168.5.13`) or external DNS (`1.1.1.1`, `8.8.8.8`).
- **Diagnostic Steps**:
  1. Check Kubernetes node status:
     ```bash
     direnv exec . kubectl get nodes -o wide
     ```
  2. Check Talos node health if nodes are `NotReady`:
     ```bash
     direnv exec . talosctl -n <node-ip> health
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
