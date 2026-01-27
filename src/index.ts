/**
 * Scallop Liquidator Lite - CLI
 *
 * Usage:
 *   pnpm sliq <obligation_id> [--check|--execute|--force]
 *
 * Modes:
 *   --check    Check obligation status and liquidation opportunity (default)
 *   --execute  Execute liquidation if profitable
 *   --force    Force execute liquidation, bypass profit check
 */

import { loadConfig, createScallopSDK } from './config.js';
import { ScallopLiquidator } from './liquidator.js';

type Mode = 'check' | 'execute' | 'force';

function parseMode(args: string[]): Mode {
  if (args.includes('--force') || args.includes('-f')) return 'force';
  if (args.includes('--execute') || args.includes('-e')) return 'execute';
  return 'check';
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const obligationId = args[0];
  const mode = parseMode(args);

  // Validate obligation ID format
  if (!obligationId.startsWith('0x') || obligationId.length !== 66) {
    console.error('Error: Invalid obligation ID format. Expected 0x followed by 64 hex characters.');
    process.exit(1);
  }

  try {
    console.log('Initializing Scallop SDK...');
    const config = loadConfig();
    const scallop = await createScallopSDK(config);
    const liquidator = new ScallopLiquidator(scallop);

    const modeLabel = mode === 'force' ? 'FORCE' : mode.toUpperCase();
    console.log(`\n[${modeLabel} MODE] Querying obligation: ${obligationId}`);
    console.log('─'.repeat(70));

    const obligationInfo = await liquidator.queryObligation(obligationId);

    // Display obligation info
    console.log('\n📊 Obligation Status:');
    console.log(`   ID: ${obligationInfo.obligationId}`);
    console.log(`   Risk Level: ${(obligationInfo.riskLevel * 100).toFixed(2)}%`);
    console.log(`   Liquidatable: ${obligationInfo.isLiquidatable ? '✅ YES' : '❌ NO'}`);

    // Display collaterals
    console.log('\n💰 Collaterals:');
    if (obligationInfo.collaterals.length === 0) {
      console.log('   (none)');
    } else {
      for (const collateral of obligationInfo.collaterals) {
        const displayName = collateral.coinSymbol || collateral.coinName;
        console.log(`   • ${displayName}: ${collateral.amountCoin.toFixed(4)} (~$${collateral.valueUsd.toFixed(2)})`);
        if (collateral.coinDisplayName && collateral.coinDisplayName !== displayName) {
          console.log(`     └─ ${collateral.coinDisplayName}`);
        }
      }
    }

    // Display debts
    console.log('\n💳 Debts:');
    if (obligationInfo.debts.length === 0) {
      console.log('   (none)');
    } else {
      for (const debt of obligationInfo.debts) {
        const displayName = debt.coinSymbol || debt.coinName;
        console.log(`   • ${displayName}: ${debt.amountCoin.toFixed(4)} (~$${debt.valueUsd.toFixed(2)})`);
        if (debt.coinDisplayName && debt.coinDisplayName !== displayName) {
          console.log(`     └─ ${debt.coinDisplayName}`);
        }
        // Show coin type for clarity (especially for bad debt)
        console.log(`     └─ Type: ${debt.coinType}`);
      }
    }

    console.log('\n' + '─'.repeat(70));

    // Check for bad debt (debt but no collateral)
    const isBadDebt = obligationInfo.debts.length > 0 && obligationInfo.collaterals.length === 0;

    if (isBadDebt) {
      console.log('\n🚨 BAD DEBT DETECTED!');
      console.log('   This obligation has debt but NO collateral.');
      console.log('   Standard liquidation is not possible.');

      if (mode !== 'force') {
        console.log('\n💡 Use --force to attempt a direct repayment (experimental)');
        process.exit(0);
      }
      console.log('\n⚠️  Force mode: attempting direct repayment...');
    }

    // If not liquidatable, exit (unless force mode)
    if (!obligationInfo.isLiquidatable && !isBadDebt) {
      console.log('\n⚠️  This obligation is not liquidatable (Risk Level < 100%)');
      if (mode !== 'force') {
        console.log('✓  Check complete - no action needed');
        process.exit(0);
      }
      console.log('⚠️  Force mode: attempting liquidation anyway...');
    }

    // Handle bad debt case (force repayment without collateral)
    if (isBadDebt && mode === 'force') {
      const primaryDebt = obligationInfo.debts[0];
      const coinDisplay = primaryDebt.coinSymbol || primaryDebt.coinName.toUpperCase();

      // Repay full bad debt amount (100%)
      const repayPercentage = 1.0;
      const repayAmountRaw = BigInt(Math.floor(primaryDebt.amount * repayPercentage));
      const repayAmountHuman = primaryDebt.amountCoin * repayPercentage;

      console.log('\n📈 Bad Debt Repayment:');
      console.log(`   Coin: ${coinDisplay} (${primaryDebt.coinDisplayName || coinDisplay})`);
      console.log(`   Coin Type: ${primaryDebt.coinType}`);
      console.log(`   Total debt: ${primaryDebt.amountCoin.toFixed(6)} ${coinDisplay}`);
      console.log(`   Repay amount (100%): ${repayAmountHuman.toFixed(6)} ${coinDisplay}`);
      console.log(`   Raw amount: ${repayAmountRaw.toString()}`);
      console.log(`   ⚠️  WARNING: You will NOT receive any collateral in return!`);
      console.log(`\n💰 Required: ${repayAmountHuman.toFixed(6)} ${coinDisplay} in your wallet`);
      console.log(`   Coin type needed: ${primaryDebt.coinType}`);

      console.log('\n🚀 Executing bad debt repayment...');

      const result = await liquidator.repayBadDebt(
        obligationId,
        primaryDebt.coinName,
        repayAmountRaw
      );

      if (result.success) {
        console.log('\n✅ Bad debt repayment successful!');
        console.log(`   Transaction: https://suivision.xyz/txblock/${result.txDigest}`);
        console.log(`   Repaid: ${result.repaidAmount}`);
      } else {
        console.log('\n❌ Bad debt repayment failed:');
        console.log(`   Error: ${result.error}`);
        process.exit(1);
      }
    }
    // If liquidatable (or force mode), show profit estimation
    else if (obligationInfo.debts.length > 0 && obligationInfo.collaterals.length > 0) {
      const primaryDebt = obligationInfo.debts[0];
      const primaryCollateral = obligationInfo.collaterals[0];

      const profitEstimate = await liquidator.estimateLiquidationProfit(
        obligationInfo,
        primaryDebt.coinName,
        primaryCollateral.coinName
      );

      console.log('\n📈 Liquidation Opportunity:');
      console.log(`   Debt to repay: ${primaryDebt.coinName}`);
      console.log(`   Collateral to receive: ${primaryCollateral.coinName}`);
      console.log(`   Estimated profit: ~$${profitEstimate.estimatedProfitUsd.toFixed(2)}`);
      console.log(`   Profitable: ${profitEstimate.profitable ? '✅ YES' : '⚠️ Marginal'}`);

      if (mode === 'check') {
        // Check mode - just report status
        console.log('\n✓  Check complete - position IS liquidatable');
        console.log('\n💡 To execute liquidation:');
        console.log(`   pnpm sliq ${obligationId} --execute    # Check profit first`);
        console.log(`   pnpm sliq ${obligationId} --force      # Bypass profit check`);
      } else if (mode === 'execute' && !profitEstimate.profitable) {
        // Execute mode but not profitable
        console.log('\n⚠️  Liquidation not profitable. Use --force to bypass this check.');
        process.exit(0);
      } else {
        // Execute or Force mode - perform liquidation
        if (mode === 'force') {
          console.log('\n⚡ Force mode: bypassing profit check...');
        }
        console.log('\n🚀 Executing liquidation...');

        // Calculate repay amount (50% of debt for safety)
        // Use raw amount (with decimals) for transaction
        const repayAmountRaw = BigInt(Math.floor(primaryDebt.amount * 0.5));

        const result = await liquidator.liquidate(
          obligationId,
          primaryDebt.coinName,
          primaryCollateral.coinName,
          repayAmountRaw
        );

        if (result.success) {
          console.log('\n✅ Liquidation successful!');
          console.log(`   Transaction: https://suivision.xyz/txblock/${result.txDigest}`);
          console.log(`   Repaid: ${result.repaidAmount}`);
        } else {
          console.log('\n❌ Liquidation failed:');
          console.log(`   Error: ${result.error}`);
          process.exit(1);
        }
      }
    } else {
      console.log('\n⚠️  No debts or collaterals found');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
Scallop Liquidator Lite
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage:
  pnpm sliq <obligation_id> [options]

Arguments:
  obligation_id    The Sui object ID of the obligation to check/liquidate

Options:
  --check, -c      Check obligation status only (default)
  --execute, -e    Execute liquidation if profitable
  --force, -f      Force execute, bypass profit check
  --help, -h       Show this help message

Examples:
  # Check obligation status (default mode)
  pnpm sliq 0x1234...abcd
  pnpm sliq 0x1234...abcd --check

  # Execute liquidation (checks profit first)
  pnpm sliq 0x1234...abcd --execute

  # Force liquidation (bypass profit check)
  pnpm sliq 0x1234...abcd --force

Environment Variables:
  PRIVATE_KEY      Your Sui wallet private key (required)
  RPC_URL          Custom RPC URL (optional)

Setup:
  1. Copy .env.example to .env
  2. Set your PRIVATE_KEY in .env
  3. Run the commands above

⚠️  WARNING: This is a lite version for educational purposes.
    Use at your own risk. Always test with small amounts first.
`);
}

main();
