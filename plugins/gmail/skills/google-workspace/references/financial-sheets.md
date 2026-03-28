# Financial Sheets Reference

## Key Spreadsheets

### Profit & Loss Statement
- **URL**: https://docs.google.com/spreadsheets/d/1o_jWQs1KjRN1aEqFDH0B1hIsq5Lye_Nu030kuvizVOs/edit?gid=195377784#gid=195377784
- **Spreadsheet ID**: `1o_jWQs1KjRN1aEqFDH0B1hIsq5Lye_Nu030kuvizVOs`
- **Sheet Name**: `P&L Statement`
- **Purpose**: Track revenue, expenses, and profit over time
- **Primary Metric**: Year-over-year profit comparison

### Balance Sheet
- **URL**: https://docs.google.com/spreadsheets/d/1o_jWQs1KjRN1aEqFDH0B1hIsq5Lye_Nu030kuvizVOs/edit?gid=1399774175#gid=1399774175
- **Spreadsheet ID**: `1o_jWQs1KjRN1aEqFDH0B1hIsq5Lye_Nu030kuvizVOs` (same as P&L)
- **Sheet Name**: `Balance Sheet`
- **Purpose**: Track assets, liabilities, and equity

### Marketing KPIs by Week
- **URL**: https://docs.google.com/spreadsheets/d/1gfnK2zgeKx7DS-9bkm2No89UodU9oRWWjaQrie7WTlc/edit?gid=20560436#gid=20560436
- **Spreadsheet ID**: `1gfnK2zgeKx7DS-9bkm2No89UodU9oRWWjaQrie7WTlc`
- **Sheet Name**: Based on gid (needs inspection)
- **Purpose**: Weekly marketing performance metrics

### Inventory Velocity by Product
- **URL**: https://docs.google.com/spreadsheets/d/1BLorqoadJW1iTn38qFtoGn_4so9P-6Kw6tta-zg7gFA/edit?gid=1423480127#gid=1423480127
- **Spreadsheet ID**: `1BLorqoadJW1iTn38qFtoGn_4so9P-6Kw6tta-zg7gFA`
- **Sheet Name**: Based on gid (needs inspection)
- **Purpose**: Track how quickly products sell

## Common Query Patterns

### Year-over-Year Profit Analysis

To calculate year-over-year profit:

1. Get P&L data for current period and previous year period
2. Extract profit/loss row (typically labeled "Net Income" or "Profit/Loss")
3. Compare values and calculate percentage change

**Example workflow:**
1. Get full P&L sheet data using range `'P&L Statement'!A1:Z100`
2. Process the data to:
   - Identify column headers (dates/periods)
   - Identify profit/loss row
   - Extract values for comparison periods
   - Calculate year-over-year change

### Financial Metrics by Period

Common time periods to analyze:
- Monthly: Compare month-over-month
- Quarterly: Compare quarter-over-quarter
- Yearly: Compare year-over-year
- Custom: Compare any two periods

### Typical P&L Structure

Most P&L statements follow this structure:

```
Row | Item
----|------------------
1   | Headers (Period names)
2   | Revenue
3   | - Product Sales
4   | - Shipping Revenue
5   | - Other Income
6   | Cost of Goods Sold (COGS)
7   | - Materials
8   | - Labor
9   | - Shipping Costs
10  | Gross Profit
11  | Operating Expenses
12  | - Marketing
13  | - Salaries
14  | - Rent
15  | - Software
16  | - Other Expenses
17  | Operating Income
18  | Other Income/Expenses
19  | Net Income (Profit/Loss)
```

**Note**: The actual structure varies by business. Always inspect the sheet first to identify:
- Which row contains profit/loss
- Which columns contain which time periods
- How dates/periods are formatted

## Data Processing Tips

### Parsing Sheet Data

1. **Headers are usually in row 1**: Column headers typically in first row
2. **Row labels in column A**: Item names typically in first column
3. **Numeric data starts in row 2, column B**: Data typically starts at B2
4. **Look for totals/subtotals**: Often in bold or with special formatting

### Handling Formatted vs Unformatted Values

- **Formatted** (`FORMATTED_VALUE`): Returns "($1,234.56)", "15%", dates as strings
- **Unformatted** (`UNFORMATTED_VALUE`): Returns -1234.56, 0.15, dates as serial numbers
- **Formula** (`FORMULA`): Returns "=SUM(A1:A10)"

For calculations, use unformatted values to get numeric values directly.

### Finding Specific Rows

To find a specific metric (e.g., "Net Income"):

1. Get the full sheet range
2. Search for the row where column A contains the metric name
3. Extract values from that row across time periods

### Date/Period Handling

Common date formats in financial sheets:
- "Jan 2024", "Feb 2024" - Monthly
- "Q1 2024", "Q2 2024" - Quarterly
- "2024", "2023" - Yearly
- "Week of 2024-01-01" - Weekly

Parse the header row to understand the time period structure.
