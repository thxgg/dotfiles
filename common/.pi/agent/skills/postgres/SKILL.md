---
name: postgres
description: PostgreSQL best practices, query optimization, schema design, and performance tuning. Use when working with Postgres databases.
---

# PostgreSQL

## Schema and Query Design

| Topic | Reference | Use for |
|------|------|------|
| Schema Design | [references/schema-design.md](references/schema-design.md) | Tables, keys, data types, and constraints |
| Indexing | [references/indexing.md](references/indexing.md) | Index types, composite indexes, and performance |
| Index Optimization | [references/index-optimization.md](references/index-optimization.md) | Unused and duplicate index audits |
| Partitioning | [references/partitioning.md](references/partitioning.md) | Large tables, time-series data, and retention |
| Query Patterns | [references/query-patterns.md](references/query-patterns.md) | JOINs, pagination, batching, and SQL anti-patterns |
| Optimization Checklist | [references/optimization-checklist.md](references/optimization-checklist.md) | Pre-optimization audit and cleanup |
| MVCC and VACUUM | [references/mvcc-vacuum.md](references/mvcc-vacuum.md) | Dead tuples, long transactions, and xid wraparound |

## Operations and Architecture

| Topic | Reference | Use for |
|------|------|------|
| Process Architecture | [references/process-architecture.md](references/process-architecture.md) | Multi-process model and connection handling |
| Memory Architecture | [references/memory-management-ops.md](references/memory-management-ops.md) | Shared memory, OS cache, and OOM prevention |
| MVCC Transactions | [references/mvcc-transactions.md](references/mvcc-transactions.md) | Isolation levels and serialization behavior |
| WAL and Checkpoints | [references/wal-operations.md](references/wal-operations.md) | Durability, checkpoints, and crash recovery |
| Replication | [references/replication.md](references/replication.md) | Streaming replication, slots, and failover |
| Storage Layout | [references/storage-layout.md](references/storage-layout.md) | PGDATA, TOAST, fillfactor, and tablespaces |
| Monitoring | [references/monitoring.md](references/monitoring.md) | `pg_stat*`, logging, and host-level metrics |
| Backup and Recovery | [references/backup-recovery.md](references/backup-recovery.md) | `pg_dump`, `pg_basebackup`, PITR, and WAL archiving |

## Sharding Readiness

| Topic | Reference | Use for |
|------|------|------|
| Sharding Readiness | [references/sharding-readiness.md](references/sharding-readiness.md) | Design choices that keep Postgres ready for future sharding |
