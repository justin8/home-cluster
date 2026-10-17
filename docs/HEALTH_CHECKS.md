# Cluster Health Check & Daily Inspection Guide

This document outlines the standard operational health check procedure run automatically each morning at **2:00 AM** (`0 2 * * *`). It serves as an authoritative reference for engineers and AI agents to resume, run, or debug cluster health inspections.

---

## 1. Automated Schedule Specification

When running or re-establishing the daily check in the AI agent framework:

- **Cron Expression:** `0 2 * * *` (Daily at 2:00 AM local time)
- **Task Type:** Standing daemon (`IsDaemon: true`)
- **Execution Environment:** `direnv exec /home/justin/src/home-cluster rtk <command>`

---

## 2. Health Check Procedure & Commands

All health checks run as read-only commands through `direnv` and `rtk` from `/home/justin/src/home-cluster`.

### Step 1: Cluster Node Health

Verify all control-plane nodes report `Ready`, correct Talos versions, and expected IPs.

```bash
direnv exec . rtk kubectl get nodes -o wide
```

### Step 2: Unscheduled, Crashing, or Non-Running Workloads

Find pods that are in unexpected states across all namespaces:

```bash
# Non-running / non-completed pods
direnv exec . rtk kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded

# Pods stuck in CrashLoopBackOff, Error, Failed, or Pending
direnv exec . rtk kubectl get pods -A | grep -E "CrashLoopBackOff|Error|Failed|Unknown|Pending"
```

> [!NOTE]
> Pods in `CrashLoopBackOff` are technically reported by Kubernetes in `phase: Running`. Combining field selector filtering with grep ensures both pending pods and crashing containers are identified.

### Step 3: GitOps & ArgoCD Application Sync

Verify that every managed application is `Healthy` and `Synced`:

```bash
direnv exec . rtk kubectl get applications -n argocd -o custom-columns=NAME:.metadata.name,HEALTH:.status.health.status,SYNC:.status.sync.status
```

### Step 4: Distributed Storage & Database Clusters

1. **Longhorn Volumes:**
   Verify volume robustness across all attached volumes:
   ```bash
   direnv exec . rtk kubectl get volumes.longhorn.io -n longhorn-system -o custom-columns=NAME:.metadata.name,ROBUSTNESS:.status.robustness,STATE:.status.state | grep -v healthy
   ```
2. **CloudNativePG (CNPG) Databases:**
   Verify all Postgres clusters report `Cluster in healthy state`, `ClusterIsReady`, and `ContinuousArchivingSuccess`:
   ```bash
   direnv exec . rtk kubectl get cluster -A
   ```

### Step 5: Live Container Log Scanning

Inspect the last 25–30 lines of logs across all running containers to catch silent application failures or continuous error bursts:

```bash
direnv exec . bash -c '
for pod in $(rtk kubectl get pods -A --field-selector=status.phase=Running -o jsonpath="{range .items[*]}{.metadata.namespace}/{.metadata.name}{\" \"}{end}"); do
  ns="${pod%%/*}"
  p="${pod##*/}"
  logs=$(rtk kubectl logs -n "$ns" "$p" --tail=30 --all-containers 2>&1)
  errs=$(echo "$logs" | grep -i -E "fatal|panic|exception|traceback" | \
         grep -v -E "TooManyRequests|429|Bad file descriptor|IOBase.__del__|Golang settings" | \
         head -n 5)
  if [ -n "$errs" ]; then
    echo "=== [$ns/$p] ==="
    echo "$errs"
  fi
done
'
```

---

## 3. Operational Rules & Noise Filtering

To avoid false alarms, the health check applies specific operational domain knowledge:

### 1. Batch Jobs & CronJobs

- **Rule:** Do **NOT** alarm on stale `Failed` pods retained by `failedJobsHistoryLimit` if the CronJob's subsequent or latest executions completed successfully.
- **Verification:** Check `rtk kubectl get cronjob,job -A`. Only alert if the latest execution failed or if there is an active recurring failure pattern.

### 2. Upstream Indexer Rate Limits (HTTP 429)

- **Rule:** In media downloaders (`sonarr`, `radarr`, `prowlarr`), HTTP `429: TooManyRequests` from upstream Usenet/torrent indexers are expected external rate limits. Do not treat these as cluster or workload failures.

### 3. Premature Socket Teardowns

- **Rule:** Python WSGI/HTTP servers (such as Cheroot in SABnzbd) frequently log `Bad file descriptor` or `IOBase.__del__` exceptions when browser clients disconnect before a response finishes. These are benign and should be filtered out.

### 4. CNPG S3/B2 WAL Archiving

- **Rule:** When initializing a fresh CNPG cluster (`initdb` on timeline 1), Barman requires an **empty target archive** (`Expected empty archive`). If the server name collides with a previous cluster prefix that contains old WALs, archiving will fail, causing WALs to accumulate until the disk fills up and CNPG stops PostgreSQL to prevent corruption.

---

## 4. Agent Resumption Instructions

If the AI agent server or conversation restarts:

1. Re-add the cron task with the `schedule` tool:
   - `CronExpression`: `0 2 * * *`
   - `IsDaemon`: `true`
   - `Prompt`: Reference the health check steps, commands, and noise filters defined in this document.
2. If the user requests an immediate check ("run now"), execute the read-only steps in Section 2 sequentially and report findings.
