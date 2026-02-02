# Scallop Liquidator Lite

Scallop Sui 借貸協議的輕量版清算機器人。

## 功能

- 查詢倉位狀態（債務、抵押品、風險等級）
- 判斷倉位是否可清算（風險等級 >= 100%）
- 估算清算利潤
- 執行清算交易
- 強制模式：繞過利潤檢查
- **壞帳偵測** - 識別有債務但無抵押品的倉位
- **鏈上直接查詢** - 當 SDK 回傳 null 時，直接從區塊鏈查詢
- **壞帳償還** - 實驗性支援償還壞帳（強制模式）

## 前置需求

- Node.js 18+
- pnpm
- 擁有私鑰的 Sui 錢包
- 足夠的餘額支付 gas 和償還債務

## 安裝

```bash
pnpm install
```

## 配置

1. 複製 `.env.example` 到 `.env`：
```bash
cp .env.example .env
```

2. 在 `.env` 中設置你的私鑰：
```
PRIVATE_KEY=你的私鑰
```

## 使用方式

### 檢查模式（預設）

只查詢倉位狀態，不執行清算：

```bash
pnpm sliq <obligation_id>
pnpm sliq <obligation_id> --check
```

### 執行模式

如果有利潤，執行清算：

```bash
pnpm sliq <obligation_id> --execute
```

### 強制模式

繞過利潤檢查，強制執行清算：

```bash
pnpm sliq <obligation_id> --force
```

## 選項說明

| 旗標 | 縮寫 | 說明 |
|------|------|------|
| `--check` | `-c` | 只檢查倉位狀態（預設）|
| `--execute` | `-e` | 有利潤時執行清算 |
| `--force` | `-f` | 強制執行，繞過利潤檢查 |
| `--help` | `-h` | 顯示幫助訊息 |

## 輸出範例

### 一般可清算倉位

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

### 壞帳偵測

當一個倉位有債務但沒有抵押品（壞帳）時，工具會偵測到：

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
   • wUSDC: 10.5911 (~$0.00)
     └─ Wormhole USDC
     └─ Type: 0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN

──────────────────────────────────────────────────────────────────────

🚨 BAD DEBT DETECTED!
   This obligation has debt but NO collateral.
   Standard liquidation is not possible.

💡 Use --force to attempt a direct repayment (experimental)
```

### 壞帳償還（強制模式）

```
[FORCE MODE] Querying obligation: 0xb227...7481
──────────────────────────────────────────────────────────────────────

🚨 BAD DEBT DETECTED!
   This obligation has debt but NO collateral.
   Standard liquidation is not possible.

⚠️  Force mode: attempting direct repayment...

📈 Bad Debt Repayment:
   Coin: wUSDC (Wormhole USDC)
   Coin Type: 0x5d4b...::coin::COIN
   Total debt: 10.591093 wUSDC
   Repay amount (100%): 10.591093 wUSDC
   Raw amount: 10591093
   ⚠️  WARNING: You will NOT receive any collateral in return!

💰 Required: 10.591093 wUSDC in your wallet
   Coin type needed: 0x5d4b...::coin::COIN

🚀 Executing bad debt repayment...

✅ Bad debt repayment successful!
   Transaction: https://suivision.xyz/txblock/...
   Repaid: 10591093
```

## 重要說明

1. **僅限主網**：Scallop SDK 目前只支援主網
2. **預言機更新**：清算前會自動更新價格
3. **部分清算**：一般清算只償還 50% 的債務，壞帳償還 100%
4. **Gas 費用**：請確保有足夠的 SUI 支付交易費
5. **壞帳處理**：有債務但無抵押品的倉位無法正常清算。使用 `--force` 嘗試直接償還（你將**不會**收到任何抵押品作為回報）
6. **SDK 備援**：當 SDK 回傳 null（例如壞帳情況）時，工具會直接查詢區塊鏈
7. **不支援的幣種**：某些幣種（如原生 USDT）可能不被 Scallop SDK 支援。常見支援幣種：usdc, wusdc, wusdt, sui, weth, cetus, sca

## 錯誤代碼

| 代碼 | 說明 | 解決方案 |
|------|------|----------|
| **770** | 倉位已鎖定在借款激勵中 | 只有擁有者可以先解除質押 |
| **1537** | 清算金額必須大於零 | 債務金額可能太小無法清算 |
| **餘額不足** | 錢包中沒有足夠的幣 | 確保你有所需的幣種 |
| **不支援的幣種** | SDK 無法識別該幣種 | 檢查該幣池是否存在於 Scallop |

## 清算機制說明

### 什麼是清算？

當借款人的抵押品價值下跌，導致風險等級（Risk Level）達到或超過 100% 時，該倉位就可以被清算。清算者可以：

1. 代為償還部分債務
2. 獲得等值抵押品 + 清算獎勵（通常 5-10%）

### 什麼是壞帳（Bad Debt）？

壞帳是指一個倉位有債務但完全沒有抵押品的情況。這通常發生在：

1. 抵押品價格急劇下跌，清算不及時
2. 之前的清算已經把所有抵押品都拿走了

**壞帳特點：**
- 無法進行標準清算（沒有抵押品可以獲得）
- SDK 的 `getObligationAccount` 會回傳 null
- 本工具會自動從鏈上直接查詢這類倉位
- 使用 `--force` 可以嘗試直接償還債務（但不會獲得任何回報）

**為什麼要償還壞帳？**
- 通常這是協議或保險基金的責任
- 個人用戶一般不需要償還壞帳
- 此功能主要用於測試和教育目的

### 風險等級計算

```
Risk Level = Weighted Borrow Value / Weighted Collateral Value

Weighted Borrow Value = Σ (借款金額 × 價格 × Borrow Weight)
Weighted Collateral Value = Σ (抵押品金額 × 價格 × Liquidation Factor)
```

**關鍵參數：**

| 參數 | 說明 | 範例 |
|------|------|------|
| **Collateral Weight** | 決定可借款比例 | SUI: 70% → $10,000 SUI 可借 $7,000 |
| **Liquidation Factor** | 清算閾值因子 | USDC: 0.9, SUI: 0.8 |
| **Borrow Weight** | 借款權重（波動資產較高）| USDC: 1.0, SUI: 1.25 |

**計算範例：**

假設用戶有：
- 抵押品：$100 USDC (Liquidation Factor: 0.9) + $200 SUI (Liquidation Factor: 0.8)
- 借款：$200 USDC (Borrow Weight: 1.0)

```
Weighted Collateral Value = ($100 × 0.9) + ($200 × 0.8) = $90 + $160 = $250
Weighted Borrow Value = $200 × 1.0 = $200
Risk Level = $200 / $250 = 80%
```

- Risk Level < 100%：安全
- Risk Level >= 100%：可清算

### 清算流程

1. 查詢目標倉位狀態
2. 確認風險等級 >= 100%
3. 更新預言機價格（必須在同一筆交易中）
4. 調用清算函數
5. 獲得抵押品（含獎勵）

## 專案結構

```
scallop-liquidator-lite/
├── src/
│   ├── index.ts          # CLI 主入口
│   ├── config.ts         # 配置和 SDK 初始化
│   ├── liquidator.ts     # 清算邏輯核心
│   └── types.ts          # 類型定義
├── .env.example          # 環境變數模板
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 參考資源

- [Scallop 官方文件](https://docs.scallop.io/)
- [Scallop SDK](https://github.com/scallop-io/sui-scallop-sdk)
- [清算函數文件](https://docs.scallop.io/integrations/contract-integration/liquidation-function)

## 免責聲明

這是一個用於教育目的的輕量版本。使用風險自負。請務必先用小額測試。

## 後續改進方向

如果要將此專案發展成完整的清算機器人，可以考慮：

1. **建立 Indexer** - 監控所有倉位的健康狀態
2. **利潤計算優化** - 考慮 gas 成本和滑點
3. **多倉位批次清算** - 提高效率
4. **閃電貸整合** - 無需自有資金進行清算
5. **MEV 保護** - 防止搶跑交易
6. **告警系統** - 發現清算機會時通知
