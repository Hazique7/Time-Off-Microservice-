// src/enums/status.enum.ts

// The HCM status is the ultimate source of truth for balances
export enum HcmStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

// ExampleHR-only metadata status. Does not affect balances or HCM.
export enum ManagerStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  MANAGER_REJECTED = 'MANAGER_REJECTED',
}