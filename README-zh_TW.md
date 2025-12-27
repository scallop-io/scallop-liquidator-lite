# Scallop Liquidator Lite

Scallop Sui 借貸協議的輕量版清算機器人。

## 功能

- 查詢倉位狀態（債務、抵押品、風險等級）
- 判斷倉位是否可清算（風險等級 >= 100%）
- 估算清算利潤
- 執行清算交易
- 強制模式：繞過利潤檢查

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

## 重要說明

1. **僅限主網**：Scallop SDK 目前只支援主網
2. **預言機更新**：清算前會自動更新價格
3. **部分清算**：為安全起見，只償還 50% 的債務
4. **Gas 費用**：請確保有足夠的 SUI 支付交易費

## 錯誤代碼

- **770**：倉位已鎖定（需先從借款激勵中解除質押）
- **1537**：清算金額必須大於零

## 清算機制說明

### 什麼是清算？

當借款人的抵押品價值下跌，導致風險等級（Risk Level）達到或超過 100% 時，該倉位就可以被清算。清算者可以：

1. 代為償還部分債務
2. 獲得等值抵押品 + 清算獎勵（通常 5-10%）

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
