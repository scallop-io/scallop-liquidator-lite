/**
 * Type definitions for Scallop Liquidator
 */

export interface ObligationInfo {
  obligationId: string;
  owner: string;
  debts: DebtInfo[];
  collaterals: CollateralInfo[];
  riskLevel: number; // >= 1.0 means liquidatable
  isLiquidatable: boolean;
}

export interface DebtInfo {
  coinType: string;
  coinName: string;
  amount: string;
  valueUsd: number;
}

export interface CollateralInfo {
  coinType: string;
  coinName: string;
  amount: string;
  valueUsd: number;
}

export interface LiquidationResult {
  success: boolean;
  txDigest?: string;
  repaidAmount?: string;
  collateralReceived?: string;
  error?: string;
}

export interface Config {
  privateKey: string;
  rpcUrl?: string;
  networkType: 'mainnet';
}
