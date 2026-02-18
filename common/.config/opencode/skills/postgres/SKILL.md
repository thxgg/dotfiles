---
name: postgres
description: PostgreSQL best practices, query optimization, schema design, and performance tuning. Load when working with Postgres databases.
---

# PostgreSQL

## Schema & Query Design

| Topic                  | Reference                                              | Use for                                                   |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| Schema Design          | [$SKILL_DIR/references/schema-design.md]               | Tables, primary keys, data types, foreign keys            |
| Indexing               | [$SKILL_DIR/references/indexing.md]                    | Index types, composite indexes, performance               |
| Index Optimization     | [$SKILL_DIR/references/index-optimization.md]          | Unused/duplicate index queries, index audit               |
| Partitioning           | [$SKILL_DIR/references/partitioning.md]                | Large tables, time-series, data retention                 |
| Query Patterns         | [$SKILL_DIR/references/query-patterns.md]              | SQL anti-patterns, JOINs, pagination, batch queries       |
| Optimization Checklist | [$SKILL_DIR/references/optimization-checklist.md]      | Pre-optimization audit, cleanup, readiness checks         |
| MVCC and VACUUM        | [$SKILL_DIR/references/mvcc-vacuum.md]                 | Dead tuples, long transactions, xid wraparound prevention |

## Operations & Architecture

| Topic                  | Reference                                              | Use for                                                         |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| Process Architecture   | [$SKILL_DIR/references/process-architecture.md]        | Multi-process model, connection pooling, auxiliary processes     |
| Memory Architecture    | [$SKILL_DIR/references/memory-management-ops.md]       | Shared/private memory layout, OS page cache, OOM prevention     |
| MVCC Transactions      | [$SKILL_DIR/references/mvcc-transactions.md]           | Isolation levels, XID wraparound, serialization errors          |
| WAL and Checkpoints    | [$SKILL_DIR/references/wal-operations.md]              | WAL internals, checkpoint tuning, durability, crash recovery    |
| Replication            | [$SKILL_DIR/references/replication.md]                 | Streaming replication, slots, sync commit, failover             |
| Storage Layout         | [$SKILL_DIR/references/storage-layout.md]              | PGDATA structure, TOAST, fillfactor, tablespaces, disk mgmt     |
| Monitoring             | [$SKILL_DIR/references/monitoring.md]                  | pg_stat views, logging, pg_stat_statements, host metrics        |
| Backup and Recovery    | [$SKILL_DIR/references/backup-recovery.md]             | pg_dump, pg_basebackup, PITR, WAL archiving, backup tools      |

## Sharding Readiness

| Topic              | Reference                                              | Use for                                                                                   |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Sharding Readiness | [$SKILL_DIR/references/sharding-readiness.md]          | Schema and query design practices that keep a Postgres database ready for future sharding  |
