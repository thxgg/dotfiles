---
name: postgres
description: PostgreSQL best practices, query optimization, schema design, and performance tuning. Load when working with Postgres databases.
---

# PostgreSQL

## Schema & Query Design

| Topic                  | Reference                                              | Use for                                                   |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Schema Design          | [references/schema-design.md]                          | Tables, primary keys, data types, foreign keys            |
| Indexing               | [references/indexing.md]                               | Index types, composite indexes, performance               |
| Index Optimization     | [references/index-optimization.md]                     | Unused/duplicate index queries, index audit               |
| Partitioning           | [references/partitioning.md]                           | Large tables, time-series, data retention                 |
| Query Patterns         | [references/query-patterns.md]                         | SQL anti-patterns, JOINs, pagination, batch queries       |
| Optimization Checklist | [references/optimization-checklist.md]                 | Pre-optimization audit, cleanup, readiness checks         |
| MVCC and VACUUM        | [references/mvcc-vacuum.md]                            | Dead tuples, long transactions, xid wraparound prevention |

## Operations & Architecture

| Topic                  | Reference                                              | Use for                                                         |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Process Architecture   | [references/process-architecture.md]                   | Multi-process model, connection pooling, auxiliary processes     |
| Memory Architecture    | [references/memory-management-ops.md]                  | Shared/private memory layout, OS page cache, OOM prevention     |
| MVCC Transactions      | [references/mvcc-transactions.md]                      | Isolation levels, XID wraparound, serialization errors          |
| WAL and Checkpoints    | [references/wal-operations.md]                         | WAL internals, checkpoint tuning, durability, crash recovery    |
| Replication            | [references/replication.md]                            | Streaming replication, slots, sync commit, failover             |
| Storage Layout         | [references/storage-layout.md]                         | PGDATA structure, TOAST, fillfactor, tablespaces, disk mgmt     |
| Monitoring             | [references/monitoring.md]                             | pg_stat views, logging, pg_stat_statements, host metrics        |
| Backup and Recovery    | [references/backup-recovery.md]                        | pg_dump, pg_basebackup, PITR, WAL archiving, backup tools      |

## Sharding Readiness

| Topic              | Reference                                              | Use for                                                                                   |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Sharding Readiness | [references/sharding-readiness.md]                     | Schema and query design practices that keep a Postgres database ready for future sharding  |
