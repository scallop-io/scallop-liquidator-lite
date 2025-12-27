/**
 * Type definitions for Scallop Liquidator
 */

export interface ObligationInfo {
  obligationId: string;
  debts: DebtInfo[];
  collaterals: CollateralInfo[];
  riskLevel: number; // >= 1.0 means liquidatable
  totalBorrowedValueWithWeight: number;
  totalRequiredCollateralValue: number;
  isLiquidatable: boolean;
}

export interface DebtInfo {
  coinType: string;
  coinName: string;
  amount: number;      // Raw amount (with decimals, e.g., 1000000 for 1 USDC)
  amountCoin: number;  // Human-readable amount (e.g., 1.0 for 1 USDC)
  valueUsd: number;
}

export interface CollateralInfo {
  coinType: string;
  coinName: string;
  amount: number;      // Raw amount (with decimals)
  amountCoin: number;  // Human-readable amount
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
