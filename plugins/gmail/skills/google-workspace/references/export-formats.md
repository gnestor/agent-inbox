# Google Drive Export Formats

Reference guide for exporting Google Workspace files to different formats.

## Overview

Google Workspace files (Docs, Sheets, Slides, etc.) are stored as structured data, not traditional file formats. To download them, you must export to a standard format using the export type parameter.

## Export Format Table

### Google Docs

| Format | MIME Type | Extension | Use Case |
|--------|-----------|-----------|----------|
| PDF | `application/pdf` | .pdf | Sharing, printing, archival |
| Microsoft Word (DOCX) | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | .docx | Editing in Microsoft Word |
| Rich Text Format | `application/rtf` | .rtf | Compatible with most word processors |
| Plain Text | `text/plain` | .txt | Simple text extraction |
| HTML | `text/html` | .html | Web publishing, email |
| EPUB | `application/epub+zip` | .epub | E-books, e-readers |
| OpenDocument Text | `application/vnd.oasis.opendocument.text` | .odt | LibreOffice, OpenOffice |

### Google Sheets

| Format | MIME Type | Extension | Use Case |
|--------|-----------|-----------|----------|
| PDF | `application/pdf` | .pdf | Sharing, printing |
| Microsoft Excel (XLSX) | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | .xlsx | Editing in Microsoft Excel |
| CSV | `text/csv` | .csv | Data import/export, simple data |
| TSV | `text/tab-separated-values` | .tsv | Tab-delimited data |
| HTML | `text/html` | .html | Web publishing |
| OpenDocument Spreadsheet | `application/vnd.oasis.opendocument.spreadsheet` | .ods | LibreOffice Calc |

**Notes:**
- CSV/TSV exports only the first sheet by default
- Multiple sheets require separate exports or XLSX format
- Formulas are evaluated in CSV/TSV exports (values only)

### Google Slides

| Format | MIME Type | Extension | Use Case |
|--------|-----------|-----------|----------|
| PDF | `application/pdf` | .pdf | Sharing, handouts |
| Microsoft PowerPoint (PPTX) | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | .pptx | Editing in Microsoft PowerPoint |
| Plain Text | `text/plain` | .txt | Speaker notes extraction |
| JPEG (PNG per slide) | `image/jpeg` | .jpg | Individual slide images |
| PNG (per slide) | `image/png` | .png | High-quality slide images |
| SVG (per slide) | `image/svg+xml` | .svg | Vector graphics |
| OpenDocument Presentation | `application/vnd.oasis.opendocument.presentation` | .odp | LibreOffice Impress |

### Google Drawings

| Format | MIME Type | Extension | Use Case |
|--------|-----------|-----------|----------|
| PDF | `application/pdf` | .pdf | Sharing, printing |
| JPEG | `image/jpeg` | .jpg | Raster image |
| PNG | `image/png` | .png | Raster image with transparency |
| SVG | `image/svg+xml` | .svg | Vector graphics (scalable) |

## Recommended Export Formats

### For Archival
- **Google Docs** -> PDF
- **Google Sheets** -> XLSX (preserves multiple sheets, formulas)
- **Google Slides** -> PDF

### For Editing in Microsoft Office
- **Google Docs** -> DOCX
- **Google Sheets** -> XLSX
- **Google Slides** -> PPTX

### For Data Processing
- **Google Sheets** -> CSV (single sheet, simple data)
- **Google Sheets** -> XLSX (multiple sheets, formulas)

### For Web Publishing
- **Google Docs** -> HTML
- **Google Sheets** -> HTML
- **Google Slides** -> PDF or HTML

## Non-Google Workspace Files

Files that are not Google Workspace files (e.g., uploaded PDFs, images, Office files) can be downloaded directly without export.

## Export Limitations

### Size Limits
- **Google Docs**: Up to 50 MB (Word format), 10 MB (PDF)
- **Google Sheets**: 5 million cells, 100 MB
- **Google Slides**: No specific limit

### Features Not Exported
Depending on format, these may not export:
- Comments and suggestions
- Version history
- Custom fonts (may be substituted)
- Some advanced formatting
- Add-ons and extensions
- Custom functions (Sheets)

## Quick Reference

```
PDF:    application/pdf
DOCX:   application/vnd.openxmlformats-officedocument.wordprocessingml.document
XLSX:   application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
PPTX:   application/vnd.openxmlformats-officedocument.presentationml.presentation
CSV:    text/csv
TXT:    text/plain
HTML:   text/html
RTF:    application/rtf
```
