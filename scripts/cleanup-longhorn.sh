#!/bin/bash

set -e

echo "🧹 Starting Longhorn cleanup..."

# Force delete failed uninstall jobs and pods
echo "Deleting failed uninstall jobs..."
kubectl delete job longhorn-uninstall -n longhorn-system --force --grace-period=0 2>/dev/null || true

echo "Force deleting all pods in longhorn-system namespace..."
kubectl delete pods --all -n longhorn-system --force --grace-period=0 2>/dev/null || true

echo "Force deleting all resources in longhorn-system namespace..."
kubectl delete all --all -n longhorn-system --force --grace-period=0 2>/dev/null || true

echo "Deleting Longhorn CRDs..."
kubectl delete crd $(kubectl get crd | grep longhorn | awk '{print $1}') --force --grace-period=0 2>/dev/null || true

echo "Deleting cluster-wide Longhorn resources..."
kubectl delete clusterrole,clusterrolebinding,storageclass,priorityclass -l app.kubernetes.io/name=longhorn --force --grace-period=0 2>/dev/null || true

echo "Deleting preflight checker resources..."
kubectl delete daemonset longhorn-preflight-checker -n default --force --grace-period=0 2>/dev/null || true
kubectl delete serviceaccount longhorn-preflight-checker -n default --force --grace-period=0 2>/dev/null || true
kubectl delete clusterrole longhorn-preflight-checker --force --grace-period=0 2>/dev/null || true
kubectl delete clusterrolebinding longhorn-preflight-checker --force --grace-period=0 2>/dev/null || true

echo "Deleting longhorn-system namespace..."
kubectl delete namespace longhorn-system --force --grace-period=0 2>/dev/null || true

echo "✅ Longhorn cleanup complete!"

# Verify cleanup
echo "🔍 Verifying cleanup..."
REMAINING=$(kubectl get all,pv,pvc,storageclass,crd,clusterrole,clusterrolebinding,priorityclass,validatingwebhookconfigurations,mutatingwebhookconfigurations,csidrivers,sa,secrets,configmaps -A 2>/dev/null | grep -i longhorn || true)

if [ -z "$REMAINING" ]; then
    echo "✅ All Longhorn resources have been successfully removed!"
else
    echo "⚠️  Some Longhorn resources may still exist:"
    echo "$REMAINING"
fi