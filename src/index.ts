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
        console.log(`   • ${collateral.coinName}: ${collateral.amount} (~$${collateral.valueUsd.toFixed(2)})`);
      }
    }

    // Display debts
    console.log('\n💳 Debts:');
    if (obligationInfo.debts.length === 0) {
      console.log('   (none)');
    } else {
      for (const debt of obligationInfo.debts) {
        console.log(`   • ${debt.coinName}: ${debt.amount} (~$${debt.valueUsd.toFixed(2)})`);
      }
    }

    console.log('\n' + '─'.repeat(70));

    // If not liquidatable, exit (unless force mode)
    if (!obligationInfo.isLiquidatable) {
      console.log('\n⚠️  This obligation is not liquidatable (Risk Level < 100%)');
      if (mode !== 'force') {
        console.log('✓  Check complete - no action needed');
        process.exit(0);
      }
      console.log('⚠️  Force mode: attempting liquidation anyway...');
    }

    // If liquidatable (or force mode), show profit estimation
    if (obligationInfo.debts.length > 0 && obligationInfo.collaterals.length > 0) {
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
        const repayAmountRaw = BigInt(Math.floor(parseFloat(primaryDebt.amount) * 0.5));

        const result = await liquidator.liquidate(
          obligationId,
          primaryDebt.coinName,
          primaryCollateral.coinName,
          repayAmountRaw
        );

        if (result.success) {
          console.log('\n✅ Liquidation successful!');
          console.log(`   Transaction: https://suiscan.xyz/mainnet/tx/${result.txDigest}`);
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
