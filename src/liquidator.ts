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

    // Extract debts
    const debts: DebtInfo[] = [];
    if (obligationAccount.debts) {
      for (const [coinName, debt] of Object.entries(obligationAccount.debts)) {
        debts.push({
          coinType: (debt as any).coinType || coinName,
          coinName: coinName,
          amount: String((debt as any).amount || 0),
          valueUsd: (debt as any).valueUsd || 0,
        });
      }
    }

    // Extract collaterals
    const collaterals: CollateralInfo[] = [];
    if (obligationAccount.collaterals) {
      for (const [coinName, collateral] of Object.entries(obligationAccount.collaterals)) {
        collaterals.push({
          coinType: (collateral as any).coinType || coinName,
          coinName: coinName,
          amount: String((collateral as any).amount || 0),
          valueUsd: (collateral as any).valueUsd || 0,
        });
      }
    }

    // Calculate risk level (collateral ratio)
    // Risk Level >= 1.0 (100%) means liquidatable
    const totalDebtUsd = debts.reduce((sum, d) => sum + d.valueUsd, 0);
    const totalCollateralUsd = collaterals.reduce((sum, c) => sum + c.valueUsd, 0);

    // Use weighted borrow limit from SDK if available, otherwise estimate
    let riskLevel = 0;
    if ((obligationAccount as any).riskLevel !== undefined) {
      riskLevel = (obligationAccount as any).riskLevel;
    } else if (totalCollateralUsd > 0) {
      // Rough estimate: assuming 75% average collateral factor
      const borrowLimit = totalCollateralUsd * 0.75;
      riskLevel = borrowLimit > 0 ? totalDebtUsd / borrowLimit : 0;
    }

    return {
      obligationId,
      owner: (obligationAccount as any).owner || '',
      debts,
      collaterals,
      riskLevel,
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
      // The SDK has liquidate in CoreNormalMethods
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
    const debt = obligationInfo.debts.find(d => d.coinName.toLowerCase() === debtCoinName.toLowerCase());
    const collateral = obligationInfo.collaterals.find(c => c.coinName.toLowerCase() === collateralCoinName.toLowerCase());

    if (!debt || !collateral) {
      return { profitable: false, estimatedProfitUsd: 0 };
    }

    // Estimated profit = collateral received * bonus - gas costs
    // This is a simplified calculation
    const maxLiquidatableUsd = Math.min(debt.valueUsd * 0.5, collateral.valueUsd); // Usually max 50% can be liquidated
    const estimatedProfitUsd = maxLiquidatableUsd * liquidationBonus;

    return {
      profitable: estimatedProfitUsd > 0.1, // Profitable if > $0.1 (after gas)
      estimatedProfitUsd,
    };
  }
}
