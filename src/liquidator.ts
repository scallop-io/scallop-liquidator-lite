/**
 * Scallop Liquidator Core Logic
 */

import { Scallop } from '@scallop-io/sui-scallop-sdk';
import type { ObligationInfo, LiquidationResult, DebtInfo, CollateralInfo } from './types.js';

// Known coin decimals for common assets
const COIN_DECIMALS: Record<string, number> = {
  'usdc': 6,
  'usdt': 6,
  'sui': 9,
  'weth': 8,
  'wbtc': 8,
  'cetus': 9,
  'apt': 8,
  'sol': 8,
  'sca': 9,
};

export class ScallopLiquidator {
  private scallop: Scallop;

  constructor(scallop: Scallop) {
    this.scallop = scallop;
  }

  /**
   * Get SuiClient from Scallop SDK
   */
  private async getSuiClient() {
    const builder = await this.scallop.createScallopBuilder();
    // Access suiKit from builder's internal structure
    const suiKit = (builder as unknown as { suiKit: { suiInteractor: { currentClient: unknown } } }).suiKit;
    return suiKit.suiInteractor.currentClient as {
      getObject: (params: { id: string; options: { showContent: boolean } }) => Promise<{
        data?: { content?: { dataType: string; fields?: Record<string, unknown> } }
      }>;
      getDynamicFields: (params: { parentId: string }) => Promise<{
        data: Array<{ objectId: string; name: { value: unknown } }>
      }>;
    };
  }

  /**
   * Query obligation details by ID
   * Falls back to direct chain query if SDK returns null
   */
  async queryObligation(obligationId: string): Promise<ObligationInfo> {
    const query = await this.scallop.createScallopQuery();

    // Get obligation account details
    const obligationAccount = await query.getObligationAccount(obligationId);

    if (obligationAccount) {
      // Use SDK response if available
      return this.parseObligationFromSDK(obligationAccount);
    }

    // Fallback: query directly from chain
    console.log('⚠️  SDK returned null, querying chain directly...');
    return this.queryObligationFromChain(obligationId);
  }

  /**
   * Parse obligation from SDK response
   */
  private parseObligationFromSDK(obligationAccount: {
    obligationId: string;
    debts?: Record<string, { coinType: string; coinName: string; borrowedAmount: number; borrowedCoin: number; borrowedValue: number } | null>;
    collaterals?: Record<string, { coinType: string; coinName: string; depositedAmount: number; depositedCoin: number; depositedValue: number } | null>;
    totalRiskLevel: number;
    totalBorrowedValueWithWeight: number;
    totalRequiredCollateralValue: number;
  }): ObligationInfo {
    // Extract debts from SDK response
    const debts: DebtInfo[] = [];
    if (obligationAccount.debts) {
      for (const [, debt] of Object.entries(obligationAccount.debts)) {
        if (debt) {
          debts.push({
            coinType: debt.coinType,
            coinName: debt.coinName,
            amount: debt.borrowedAmount,
            amountCoin: debt.borrowedCoin,
            valueUsd: debt.borrowedValue,
          });
        }
      }
    }

    // Extract collaterals from SDK response
    const collaterals: CollateralInfo[] = [];
    if (obligationAccount.collaterals) {
      for (const [, collateral] of Object.entries(obligationAccount.collaterals)) {
        if (collateral) {
          collaterals.push({
            coinType: collateral.coinType,
            coinName: collateral.coinName,
            amount: collateral.depositedAmount,
            amountCoin: collateral.depositedCoin,
            valueUsd: collateral.depositedValue,
          });
        }
      }
    }

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
   * Query obligation directly from chain (fallback for bad debt)
   */
  private async queryObligationFromChain(obligationId: string): Promise<ObligationInfo> {
    const client = await this.getSuiClient();

    // Get obligation object
    const objResponse = await client.getObject({
      id: obligationId,
      options: { showContent: true }
    });

    if (!objResponse.data?.content || objResponse.data.content.dataType !== 'moveObject') {
      throw new Error(`Obligation not found: ${obligationId}`);
    }

    const fields = (objResponse.data.content as { fields: Record<string, unknown> }).fields;

    // Parse debts table
    const debtsTable = fields.debts as {
      fields: {
        keys: { fields: { contents: Array<{ fields: { name: string } }> } };
        table: { fields: { id: { id: string }; size: string } };
      }
    };

    const debts: DebtInfo[] = [];
    const debtKeys = debtsTable.fields.keys.fields.contents || [];
    const debtTableId = debtsTable.fields.table.fields.id.id;

    if (debtKeys.length > 0) {
      // Query dynamic fields for debts
      const debtFields = await client.getDynamicFields({ parentId: debtTableId });

      for (const df of debtFields.data) {
        const debtObj = await client.getObject({
          id: df.objectId,
          options: { showContent: true }
        });

        if (debtObj.data?.content && 'fields' in debtObj.data.content) {
          const debtContent = debtObj.data.content.fields as {
            name: { fields: { name: string } };
            value: { fields: { amount: string; borrow_index: string } };
          };

          const coinTypeFull = debtContent.name.fields.name;
          const coinName = this.extractCoinName(coinTypeFull);
          const rawAmount = Number(debtContent.value.fields.amount);
          const decimals = COIN_DECIMALS[coinName.toLowerCase()] || 9;

          debts.push({
            coinType: '0x' + coinTypeFull,
            coinName,
            amount: rawAmount,
            amountCoin: rawAmount / Math.pow(10, decimals),
            valueUsd: 0, // Can't determine USD value without price oracle
          });
        }
      }
    }

    // Parse collaterals table
    const collateralsTable = fields.collaterals as {
      fields: {
        keys: { fields: { contents: Array<{ fields: { name: string } }> } };
        table: { fields: { id: { id: string }; size: string } };
      }
    };

    const collaterals: CollateralInfo[] = [];
    const collateralKeys = collateralsTable.fields.keys.fields.contents || [];
    const collateralTableId = collateralsTable.fields.table.fields.id.id;

    if (collateralKeys.length > 0) {
      const collateralFields = await client.getDynamicFields({ parentId: collateralTableId });

      for (const df of collateralFields.data) {
        const collateralObj = await client.getObject({
          id: df.objectId,
          options: { showContent: true }
        });

        if (collateralObj.data?.content && 'fields' in collateralObj.data.content) {
          const collContent = collateralObj.data.content.fields as {
            name: { fields: { name: string } };
            value: { fields: { amount: string } };
          };

          const coinTypeFull = collContent.name.fields.name;
          const coinName = this.extractCoinName(coinTypeFull);
          const rawAmount = Number(collContent.value.fields.amount);
          const decimals = COIN_DECIMALS[coinName.toLowerCase()] || 9;

          collaterals.push({
            coinType: '0x' + coinTypeFull,
            coinName,
            amount: rawAmount,
            amountCoin: rawAmount / Math.pow(10, decimals),
            valueUsd: 0,
          });
        }
      }
    }

    // Calculate risk level: if no collateral but has debt, risk is infinite (use 999)
    const hasDebt = debts.length > 0;
    const hasCollateral = collaterals.length > 0;
    const riskLevel = hasDebt && !hasCollateral ? 999 : (hasDebt ? 1.0 : 0);

    return {
      obligationId,
      debts,
      collaterals,
      riskLevel,
      totalBorrowedValueWithWeight: 0, // Unknown without oracle
      totalRequiredCollateralValue: 0,
      isLiquidatable: hasDebt && hasCollateral && riskLevel >= 1.0,
    };
  }

  /**
   * Extract coin name from full type path
   * e.g., "dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC" -> "usdc"
   */
  private extractCoinName(coinTypeFull: string): string {
    const parts = coinTypeFull.split('::');
    if (parts.length >= 2) {
      return parts[1]; // Return module name (e.g., "usdc")
    }
    return coinTypeFull;
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
   * Repay bad debt (debt without collateral)
   * This is experimental and may not work depending on protocol rules
   */
  async repayBadDebt(
    obligationId: string,
    debtCoinName: string,
    repayAmount: bigint
  ): Promise<LiquidationResult> {
    try {
      const builder = await this.scallop.createScallopBuilder();
      const tx = builder.createTxBlock();

      // Set the sender address
      tx.setSender(builder.walletAddress);

      // Update oracle price for the debt coin
      await tx.updateAssetPricesQuick([debtCoinName]);

      // Get repay coins using builder's selectCoin
      const { takeCoin: repayCoin, leftCoin } = await builder.selectCoin(
        tx,
        debtCoinName,
        Number(repayAmount),
        builder.walletAddress
      );

      // Use the regular repay method
      // Signature: repay(obligation, coin, poolCoinName)
      tx.repay(obligationId, repayCoin, debtCoinName);

      // Transfer remaining coins back if any
      if (leftCoin) {
        tx.transferObjects([leftCoin], builder.walletAddress);
      }

      // Execute transaction
      const result = await builder.signAndSendTxBlock(tx);

      return {
        success: true,
        txDigest: result.digest,
        repaidAmount: repayAmount.toString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for common errors
      if (errorMsg.includes('No valid coins') || errorMsg.includes('Insufficient')) {
        const decimals = COIN_DECIMALS[debtCoinName.toLowerCase()] || 9;
        const humanAmount = Number(repayAmount) / Math.pow(10, decimals);
        return {
          success: false,
          error: `Insufficient ${debtCoinName.toUpperCase()} balance. Required: ${humanAmount.toFixed(6)} ${debtCoinName.toUpperCase()}. Please ensure you have enough ${debtCoinName.toUpperCase()} in your wallet.`,
        };
      }

      return {
        success: false,
        error: errorMsg,
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
