# Scallop Liquidator Lite

A lightweight liquidation bot for Scallop Sui Lending Protocol.

## Features

- Query obligation status (debts, collaterals, risk level)
- Check if position is liquidatable (Risk Level >= 100%)
- Estimate liquidation profit
- Execute liquidation transactions
- Force mode to bypass profit checks
- **Bad debt detection** - Identifies obligations with debt but no collateral
- **Direct chain query fallback** - Queries blockchain directly when SDK returns null
- **Bad debt repayment** - Experimental support for repaying bad debt (force mode)

## Prerequisites

- Node.js 18+
- pnpm
- Sui wallet with private key
- Sufficient balance for gas and debt repayment

## Installation

```bash
pnpm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Set your private key in `.env`:
```
PRIVATE_KEY=your_private_key_here
```

## Usage

### Check Mode (Default)

Query obligation status without executing:

```bash
pnpm sliq <obligation_id>
pnpm sliq <obligation_id> --check
```

### Execute Mode

Execute liquidation if profitable:

```bash
pnpm sliq <obligation_id> --execute
```

### Force Mode

Force execute liquidation, bypass profit check:

```bash
pnpm sliq <obligation_id> --force
```

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--check` | `-c` | Check obligation status only (default) |
| `--execute` | `-e` | Execute liquidation if profitable |
| `--force` | `-f` | Force execute, bypass profit check |
| `--help` | `-h` | Show help message |

## Output Examples

### Normal Liquidatable Position

```
[CHECK MODE] Querying obligation: 0x1234...abcd
──────────────────────────────────────────────────────────────────────

📊 Obligation Status:
   ID: 0x1234...abcd
   Risk Level: 105.23%
   Liquidatable: ✅ YES

💰 Collaterals:
   • sui: 100.5 (~$150.75)

💳 Debts:
   • usdc: 120.0 (~$120.00)

──────────────────────────────────────────────────────────────────────

📈 Liquidation Opportunity:
   Debt to repay: usdc
   Collateral to receive: sui
   Estimated profit: ~$3.00
   Profitable: ✅ YES

✓  Check complete - position IS liquidatable

💡 To execute liquidation:
   pnpm sliq 0x1234...abcd --execute    # Check profit first
   pnpm sliq 0x1234...abcd --force      # Bypass profit check
```

### Bad Debt Detection

When an obligation has debt but no collateral (bad debt), the tool will detect it:

```
[CHECK MODE] Querying obligation: 0xb227...7481
──────────────────────────────────────────────────────────────────────
⚠️  SDK returned null, querying chain directly...

📊 Obligation Status:
   ID: 0xb227...7481
   Risk Level: 99900.00%
   Liquidatable: ❌ NO

💰 Collaterals:
   (none)

💳 Debts:
   • usdc: 10.5911 (~$0.00)

──────────────────────────────────────────────────────────────────────

🚨 BAD DEBT DETECTED!
   This obligation has debt but NO collateral.
   Standard liquidation is not possible.

💡 Use --force to attempt a direct repayment (experimental)
```

### Bad Debt Repayment (Force Mode)

```
[FORCE MODE] Querying obligation: 0xb227...7481
──────────────────────────────────────────────────────────────────────

🚨 BAD DEBT DETECTED!
   This obligation has debt but NO collateral.
   Standard liquidation is not possible.

⚠️  Force mode: attempting direct repayment...

📈 Bad Debt Repayment:
   Total debt: 10.591093 USDC
   Repay amount (10%): 1.059109 USDC
   Raw amount: 1059109
   ⚠️  WARNING: You will NOT receive any collateral in return!

💰 Required: 1.059109 USDC in your wallet

🚀 Executing bad debt repayment...

✅ Bad debt repayment successful!
   Transaction: https://suiscan.xyz/mainnet/tx/DTSHrvJf8KriNU6r1NNGFAr43RAnDtyZvjqg3bDqXaD2
   Repaid: 1059109
```

## Important Notes

1. **Mainnet Only**: The Scallop SDK only supports mainnet
2. **Oracle Update**: Prices are automatically updated before liquidation
3. **Partial Liquidation**: Only 50% of debt is repaid for safety (10% for bad debt)
4. **Gas Costs**: Ensure sufficient SUI for transaction fees
5. **Bad Debt**: Obligations with debt but no collateral cannot be liquidated normally. Use `--force` to attempt direct repayment (you will NOT receive any collateral in return)
6. **SDK Fallback**: If the SDK returns null (e.g., for bad debt), the tool queries the blockchain directly

## Error Codes

- **770**: Obligation is locked (unstake from borrow incentive first)
- **1537**: Liquidation amount must be greater than zero

## Bad Debt

Bad debt occurs when an obligation has debt but no collateral. This typically happens when:

1. Collateral prices dropped drastically and liquidation wasn't timely
2. Previous liquidations have already seized all collateral

**Characteristics:**
- Cannot be liquidated normally (no collateral to receive)
- SDK's `getObligationAccount` returns null
- This tool automatically queries blockchain directly for such positions
- Use `--force` to attempt direct debt repayment (you will NOT receive any collateral)

**Why repay bad debt?**
- Usually the protocol or insurance fund's responsibility
- Individual users typically don't need to repay bad debt
- This feature is mainly for testing and educational purposes

## Risk Level Calculation

```
Risk Level = Weighted Borrow Value / Weighted Collateral Value

Weighted Borrow Value = Σ (Borrow Amount × Price × Borrow Weight)
Weighted Collateral Value = Σ (Collateral Amount × Price × Liquidation Factor)
```

**Key Parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| **Collateral Weight** | Determines borrowing capacity | SUI: 70% → $10,000 SUI can borrow $7,000 |
| **Liquidation Factor** | Threshold for liquidation | USDC: 0.9, SUI: 0.8 |
| **Borrow Weight** | Higher for volatile assets | USDC: 1.0, SUI: 1.25 |

**Example:**

User has:
- Collateral: $100 USDC (LF: 0.9) + $200 SUI (LF: 0.8)
- Borrowed: $200 USDC (BW: 1.0)

```
Weighted Collateral = ($100 × 0.9) + ($200 × 0.8) = $250
Weighted Borrow = $200 × 1.0 = $200
Risk Level = $200 / $250 = 80% (Safe)
```

- Risk Level < 100%: Safe
- Risk Level >= 100%: Liquidatable

## Resources

- [Scallop Documentation](https://docs.scallop.io/)
- [Scallop SDK](https://github.com/scallop-io/sui-scallop-sdk)
- [Liquidation Function](https://docs.scallop.io/integrations/contract-integration/liquidation-function)

## Disclaimer

This is a lite version for educational purposes. Use at your own risk. Always test with small amounts first.
