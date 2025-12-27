/**
 * Scallop Liquidator Core Logic
 */

import { Scallop } from '@scallop-io/sui-scallop-sdk';
import type { ObligationInfo, LiquidationResult, DebtInfo, CollateralInfo } from './types.js';

export class ScallopLiquidator {
  private scallop: Scallop;

  constructor(scallop: Scallop) {
    this.scallop = scallop;
  }

  /**
   * Query obligation details by ID
   */
  async queryObligation(obligationId: string): Promise<ObligationInfo> {
    const query = await this.scallop.createScallopQuery();

    // Get obligation account details
    const obligationAccount = await query.getObligationAccount(obligationId);

    if (!obligationAccount) {
      throw new Error(`Obligation not found: ${obligationId}`);
    }

    // Extract debts from SDK response
    // SDK ObligationDebt: { coinName, coinType, borrowedAmount, borrowedCoin, borrowedValue, ... }
    const debts: DebtInfo[] = [];
    if (obligationAccount.debts) {
      for (const [coinName, debt] of Object.entries(obligationAccount.debts)) {
        if (debt) {
          debts.push({
            coinType: debt.coinType,
            coinName: debt.coinName,
            amount: debt.borrowedAmount,      // Raw amount (with decimals)
            amountCoin: debt.borrowedCoin,    // Human-readable amount
            valueUsd: debt.borrowedValue,
          });
        }
      }
    }

    // Extract collaterals from SDK response
    // SDK ObligationCollateral: { coinName, coinType, depositedAmount, depositedCoin, depositedValue, ... }
    const collaterals: CollateralInfo[] = [];
    if (obligationAccount.collaterals) {
      for (const [coinName, collateral] of Object.entries(obligationAccount.collaterals)) {
        if (collateral) {
          collaterals.push({
            coinType: collateral.coinType,
            coinName: collateral.coinName,
            amount: collateral.depositedAmount,   // Raw amount (with decimals)
            amountCoin: collateral.depositedCoin, // Human-readable amount
            valueUsd: collateral.depositedValue,
          });
        }
      }
    }

    // Use SDK's totalRiskLevel directly
    // Risk Level >= 1.0 (100%) means liquidatable
    const riskLevel = obligationAccount.totalRiskLevel;

    return {
      obligationId: obligationAccount.obligationId,
      debts,
      collaterals,
      riskLevel,
      totalBorrowedValueWithWeight: obligationAccount.totalBorrowedValueWithWeight,
      totalRequiredCollateralValue: obligationAccount.totalRequiredCollateralValue,
      isLiquidatable: riskLevel >= 1.0,
    };
  }

  /**
   * Execute liquidation
   *
   * @param obligationId - The obligation to liquidate
   * @param debtCoinName - The debt coin to repay (e.g., 'usdc', 'sui')
   * @param collateralCoinName - The collateral coin to receive (e.g., 'sui', 'weth')
   * @param repayAmount - Amount to repay (in base units)
   */
  async liquidate(
    obligationId: string,
    debtCoinName: string,
    collateralCoinName: string,
    repayAmount: bigint
  ): Promise<LiquidationResult> {
    try {
      const builder = await this.scallop.createScallopBuilder();
      const tx = builder.createTxBlock();

      // Step 1: Update oracle prices (required before liquidation)
      await tx.updateAssetPricesQuick([debtCoinName, collateralCoinName]);

      // Step 2: Get repay coins using builder's selectCoin
      const { takeCoin: repayCoin } = await builder.selectCoin(
        tx,
        debtCoinName,
        Number(repayAmount),
        builder.walletAddress
      );

      // Step 3: Call liquidate function using SDK's built-in method
      // Signature: liquidate(obligation, coin, debtCoinName, collateralCoinName)
      const [remainingDebt, liquidatedCollateral] = tx.liquidate(
        obligationId,
        repayCoin,
        debtCoinName,
        collateralCoinName
      );

      // Transfer remaining debt and received collateral to sender
      tx.transferObjects(
        [remainingDebt, liquidatedCollateral],
        builder.walletAddress
      );

      // Execute transaction
      const result = await builder.signAndSendTxBlock(tx);

      return {
        success: true,
        txDigest: result.digest,
        repaidAmount: repayAmount.toString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Estimate liquidation profit
   */
  async estimateLiquidationProfit(
    obligationInfo: ObligationInfo,
    debtCoinName: string,
    collateralCoinName: string,
    liquidationBonus: number = 0.05 // 5% default bonus
  ): Promise<{ profitable: boolean; estimatedProfitUsd: number }> {
    const debt = obligationInfo.debts.find(
      d => d.coinName.toLowerCase() === debtCoinName.toLowerCase()
    );
    const collateral = obligationInfo.collaterals.find(
      c => c.coinName.toLowerCase() === collateralCoinName.toLowerCase()
    );

    if (!debt || !collateral) {
      return { profitable: false, estimatedProfitUsd: 0 };
    }

    // Estimated profit = collateral received * bonus - gas costs
    // This is a simplified calculation
    // Usually max 50% of debt can be liquidated at once
    const maxLiquidatableUsd = Math.min(debt.valueUsd * 0.5, collateral.valueUsd);
    const estimatedProfitUsd = maxLiquidatableUsd * liquidationBonus;

    return {
      profitable: estimatedProfitUsd > 0.1, // Profitable if > $0.1 (after gas)
      estimatedProfitUsd,
    };
  }
}
