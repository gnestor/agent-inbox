# Google Sheets Workflow Examples

Step-by-step examples for common Google Sheets operations.

## Year-over-Year Profit Analysis

**User request**: "What's our year-over-year profit?"

**Process**:
1. Get P&L data using unformatted values for range `'P&L Statement'!A1:Z100`
2. Parse the data to identify:
   - Header row with time periods (columns)
   - Net Income/Profit row (typically labeled "Net Income" or "Profit/Loss")
3. Extract profit values for:
   - Current period (e.g., "2024")
   - Same period last year (e.g., "2023")
4. Calculate:
   - Absolute change: `profit_2024 - profit_2023`
   - Percentage change: `((profit_2024 - profit_2023) / profit_2023) * 100`
5. Present results with context

## Multi-Sheet Analysis

**User request**: "Compare revenue and expenses across quarters"

**Process**:
1. Use batch get to fetch multiple ranges or sheets
2. Process each range separately
3. Combine results for comparison
4. Calculate trends and insights

## Creating a New Tracking Spreadsheet

**User request**: "Create a new spreadsheet to track weekly sales"

**Process**:
1. Create spreadsheet with title "Weekly Sales Tracker 2024" and sheets "Sales", "Summary"
2. Note the returned spreadsheet ID
3. Add headers to Sales sheet: `[["Week","Product","Quantity","Revenue"]]`
4. Optionally add formulas in Summary sheet

## Appending New Data

**User request**: "Add this week's sales data to the tracker"

**Process**:
1. Get current data to determine last row
2. Append new data with insert rows option
3. Verify the append

## Batch Updating Multiple Metrics

**User request**: "Update Q4 numbers across all financial sheets"

**Process**:
1. Prepare data structure with multiple ranges
2. Use batch update to update all ranges at once

## Applying Cell Formatting

**User request**: "Format the revenue column as currency with green background"

**Process**:
1. Use batch update spreadsheet with formatting requests using `repeatCell`
2. Specify number format and background color

## Copying Template Sheet

**User request**: "Copy the monthly report template to a new spreadsheet"

**Process**:
1. List sheets to get template sheet ID
2. Create destination spreadsheet
3. Copy template sheet to destination
