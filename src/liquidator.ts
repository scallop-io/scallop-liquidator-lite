/**
 * Scallop Liquidator Core Logic
 */

import { Scallop } from '@scallop-io/sui-scallop-sdk';
import type { ObligationInfo, LiquidationResult, DebtInfo, CollateralInfo } from './types.js';

// Known coin decimals for common assets
const COIN_DECIMALS: Record<string, number> = {
  'usdc': 6,
  'wusdc': 6,
  'usdt': 6,
  'wusdt': 6,
  'sui': 9,
  'weth': 8,
  'eth': 8,
  'wbtc': 8,
  'cetus': 9,
  'apt': 8,
  'sol': 8,
  'wsol': 8,
  'sca': 9,
};

// Known coin type addresses to human-readable names and SDK names
const KNOWN_COIN_TYPES: Record<string, { name: string; symbol: string; sdkName: string }> = {
  // Native USDC
  'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': {
    name: 'USD Coin',
    symbol: 'USDC',
    sdkName: 'usdc',
  },
  // Wormhole USDC
  '5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': {
    name: 'Wormhole USDC',
    symbol: 'wUSDC',
    sdkName: 'wusdc',
  },
  // Wormhole USDT
  'c060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': {
    name: 'Wormhole USDT',
    symbol: 'wUSDT',
    sdkName: 'wusdt',
  },
  // Wormhole ETH
  'af8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': {
    name: 'Wormhole ETH',
    symbol: 'wETH',
    sdkName: 'weth',
  },
  // Native SUI
  '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': {
    name: 'Sui',
    symbol: 'SUI',
    sdkName: 'sui',
  },
  // CETUS
  '06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS': {
    name: 'Cetus',
    symbol: 'CETUS',
    sdkName: 'cetus',
  },
  // SCA
  '7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA': {
    name: 'Scallop',
    symbol: 'SCA',
    sdkName: 'sca',
  },
  // Native USDT (may not be supported by Scallop)
  '375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT': {
    name: 'Native USDT',
    symbol: 'USDT',
    sdkName: 'usdt', // Note: Scallop may only support wusdt (Wormhole USDT)
  },
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
          // SDK provides coinName directly (e.g., "usdc", "sui")
          const symbol = debt.coinName.toUpperCase();
          debts.push({
            coinType: debt.coinType,
            coinName: debt.coinName,
            coinSymbol: symbol,
            coinDisplayName: symbol,
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
          const symbol = collateral.coinName.toUpperCase();
          collaterals.push({
            coinType: collateral.coinType,
            coinName: collateral.coinName,
            coinSymbol: symbol,
            coinDisplayName: symbol,
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
    let client;
    try {
      client = await this.getSuiClient();
    } catch (error) {
      throw new Error(`Failed to get Sui client: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Get obligation object
    let objResponse;
    try {
      objResponse = await client.getObject({
        id: obligationId,
        options: { showContent: true }
      });
    } catch (error) {
      throw new Error(`Failed to query obligation from chain: ${error instanceof Error ? error.message : String(error)}`);
    }

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
          const coinInfo = this.extractCoinInfo(coinTypeFull);
          const rawAmount = Number(debtContent.value.fields.amount);
          const decimals = COIN_DECIMALS[coinInfo.sdkName.toLowerCase()] || COIN_DECIMALS[coinInfo.symbol.toLowerCase()] || 6;

          debts.push({
            coinType: '0x' + coinTypeFull,
            coinName: coinInfo.sdkName,
            coinSymbol: coinInfo.symbol,
            coinDisplayName: coinInfo.name,
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
          const coinInfo = this.extractCoinInfo(coinTypeFull);
          const rawAmount = Number(collContent.value.fields.amount);
          const decimals = COIN_DECIMALS[coinInfo.sdkName.toLowerCase()] || COIN_DECIMALS[coinInfo.symbol.toLowerCase()] || 9;

          collaterals.push({
            coinType: '0x' + coinTypeFull,
            coinName: coinInfo.sdkName,
            coinSymbol: coinInfo.symbol,
            coinDisplayName: coinInfo.name,
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
   * Extract coin info from full type path
   * Returns { name: display name, symbol: ticker, sdkName: name for SDK calls }
   */
  private extractCoinInfo(coinTypeFull: string): { name: string; symbol: string; sdkName: string } {
    // Check if it's a known coin type
    if (KNOWN_COIN_TYPES[coinTypeFull]) {
      const known = KNOWN_COIN_TYPES[coinTypeFull];
      return {
        name: known.name,
        symbol: known.symbol,
        sdkName: known.sdkName,
      };
    }

    // Fallback: extract from type path
    const parts = coinTypeFull.split('::');
    if (parts.length >= 3) {
      const moduleName = parts[1];
      const structName = parts[2];
      // If module name is generic like "coin", use struct name
      if (moduleName.toLowerCase() === 'coin') {
        return {
          name: `Unknown (${structName})`,
          symbol: structName,
          sdkName: structName.toLowerCase(),
        };
      }
      return {
        name: structName,
        symbol: structName,
        sdkName: moduleName.toLowerCase(),
      };
    }

    return {
      name: coinTypeFull,
      symbol: coinTypeFull,
      sdkName: coinTypeFull,
    };
  }

  /**
   * Extract coin name from full type path (legacy, for SDK calls)
   */
  private extractCoinName(coinTypeFull: string): string {
    return this.extractCoinInfo(coinTypeFull).sdkName;
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
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for obligation locked error (770)
      if (errorMsg.includes('770')) {
        return {
          success: false,
          error: `Obligation is locked (Error 770). The obligation owner has staked this in the borrow incentive program. It cannot be liquidated until the owner unstakes it.`,
        };
      }

      // Check for zero amount error (1537)
      if (errorMsg.includes('1537')) {
        return {
          success: false,
          error: `Liquidation amount must be greater than zero (Error 1537). The debt may be too small to liquidate.`,
        };
      }

      // Check for insufficient balance
      if (errorMsg.includes('No valid coins') || errorMsg.includes('Insufficient')) {
        const decimals = COIN_DECIMALS[debtCoinName.toLowerCase()] || 9;
        const humanAmount = Number(repayAmount) / Math.pow(10, decimals);
        return {
          success: false,
          error: `Insufficient ${debtCoinName.toUpperCase()} balance. Required: ${humanAmount.toFixed(6)} ${debtCoinName.toUpperCase()}. Please ensure you have enough ${debtCoinName.toUpperCase()} in your wallet.`,
        };
      }

      // Check for unsupported coin pool
      if (errorMsg.includes('Cannot convert undefined') || errorMsg.includes('Cannot convert null')) {
        return {
          success: false,
          error: `Coin "${debtCoinName}" or "${collateralCoinName}" is not supported by Scallop SDK. Common supported coins: usdc, wusdc, wusdt, sui, weth, cetus, sca.`,
        };
      }

      return {
        success: false,
        error: errorMsg,
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

      // Check for obligation locked error (770)
      if (errorMsg.includes('770')) {
        return {
          success: false,
          error: `Obligation is locked (Error 770). The obligation owner has staked this in the borrow incentive program. It cannot be repaid until the owner unstakes it.`,
        };
      }

      // Check for unsupported coin pool
      if (errorMsg.includes('Cannot convert undefined') || errorMsg.includes('Cannot convert null')) {
        return {
          success: false,
          error: `Coin "${debtCoinName}" is not supported by Scallop SDK. This debt may be in a coin that Scallop no longer supports or was never a valid lending pool. Common supported coins: usdc, wusdc, wusdt, sui, weth, cetus, sca.`,
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
