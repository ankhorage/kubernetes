---
'@ankhorage/kubernetes': patch
---

Allow transient Deployment `CrashLoopBackOff` states to recover within a bounded readiness grace period while keeping hard startup failures immediately fatal.
