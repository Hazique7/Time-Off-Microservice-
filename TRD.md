---

### 2. The `TRD.md` File


```markdown
# 📄 Technical Requirement Document (TRD)

## 1. Overview
This document describes the design of the Time-Off Microservice for ExampleHR, acting as a reliable intermediary between the platform and an external HCM system.

## 2. Key Challenges & Mitigations

### 2.1 Floating-Point Precision
* **Challenge**: JavaScript's native number type causes binary rounding errors.
* **Mitigation**: Implemented an **Integer Math Utility** operating in units of half-days to ensure 100% arithmetic accuracy.

### 2.2 Race Conditions
* **Challenge**: Concurrent requests could pass validation simultaneously but together exceed the balance.
* **Mitigation**: Used **Row-Level Locking** on the balance record during validation to ensure only one deduction occurs at a time.

### 2.3 Distributed Transaction Integrity
* **Challenge**: If a DB update succeeds but the HCM call fails, the systems drift.
* **Mitigation**: Transactions are committed before the network call, with a secondary atomic transaction used to refund the balance if the HCM returns a failure.

## 3. Analysis of Alternatives Considered

### 3.1 SQLite vs. PostgreSQL
* **Decision**: **SQLite**.
* **Rationale**: Provides zero-config portability for reviewers while meeting relational data integrity needs. TypeORM allows for future migration to Postgres with minimal changes.

### 3.2 HCM Submission Timing
* **Decision**: **Immediate HCM Call**.
* **Rationale**: Calling the HCM immediately upon employee submission (rather than waiting for manager approval) ensures the deduction is registered before conflicts occur.

### 3.3 Seeding Method
* **Decision**: **REST Seed Controller**.
* **Rationale**: Allows the reviewer to populate the database via standard HTTP tools without needing local SQL command-line tools.

## 4. Testing Strategy
* **Unit Testing**: Verified pure logic like `BalanceMath` and `StateMachine`.
* **Mocking**: A `MockHcmModule` simulates network conditions (latency, success, and errors) to verify service resilience 