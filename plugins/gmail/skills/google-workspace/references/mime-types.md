# Google Drive MIME Types Reference

Complete list of MIME types for Google Drive files, used in search queries and file operations.

## Google Workspace MIME Types

### Core Applications

| Application | MIME Type |
|------------|-----------|
| Google Drive Folder | `application/vnd.google-apps.folder` |
| Google Doc | `application/vnd.google-apps.document` |
| Google Sheet | `application/vnd.google-apps.spreadsheet` |
| Google Slides | `application/vnd.google-apps.presentation` |
| Google Forms | `application/vnd.google-apps.form` |
| Google Drawings | `application/vnd.google-apps.drawing` |
| Google My Maps | `application/vnd.google-apps.map` |
| Google Sites | `application/vnd.google-apps.site` |
| Google Apps Scripts | `application/vnd.google-apps.script` |

### Other Google Workspace Types

| Type | MIME Type |
|------|-----------|
| Google Fusion Tables | `application/vnd.google-apps.fusiontable` |
| Google Jamboard | `application/vnd.google-apps.jam` |
| Shortcut (link to file) | `application/vnd.google-apps.shortcut` |
| 3rd party shortcut | `application/vnd.google-apps.drive-sdk` |

## Document Formats

### Microsoft Office

| Format | MIME Type |
|--------|-----------|
| Word (.docx) | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Word (.doc) | `application/msword` |
| Excel (.xlsx) | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Excel (.xls) | `application/vnd.ms-excel` |
| PowerPoint (.pptx) | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| PowerPoint (.ppt) | `application/vnd.ms-powerpoint` |

### OpenDocument

| Format | MIME Type |
|--------|-----------|
| ODF Text | `application/vnd.oasis.opendocument.text` |
| ODF Spreadsheet | `application/vnd.oasis.opendocument.spreadsheet` |
| ODF Presentation | `application/vnd.oasis.opendocument.presentation` |

### Other Documents

| Format | MIME Type |
|--------|-----------|
| PDF | `application/pdf` |
| Rich Text Format (.rtf) | `application/rtf` |
| Plain Text (.txt) | `text/plain` |
| CSV | `text/csv` |
| HTML | `text/html` |
| Markdown | `text/markdown` |

## Image Formats

| Format | MIME Type |
|--------|-----------|
| JPEG | `image/jpeg` |
| PNG | `image/png` |
| GIF | `image/gif` |
| BMP | `image/bmp` |
| WebP | `image/webp` |
| SVG | `image/svg+xml` |
| TIFF | `image/tiff` |
| ICO | `image/x-icon` |
| HEIC | `image/heic` |

## Video Formats

| Format | MIME Type |
|--------|-----------|
| MP4 | `video/mp4` |
| QuickTime (.mov) | `video/quicktime` |
| AVI | `video/x-msvideo` |
| MPEG | `video/mpeg` |
| WebM | `video/webm` |
| MKV | `video/x-matroska` |

## Audio Formats

| Format | MIME Type |
|--------|-----------|
| MP3 | `audio/mpeg` |
| WAV | `audio/wav` |
| OGG | `audio/ogg` |
| AAC | `audio/aac` |
| FLAC | `audio/flac` |
| M4A | `audio/mp4` |

## Archive Formats

| Format | MIME Type |
|--------|-----------|
| ZIP | `application/zip` |
| RAR | `application/vnd.rar` |
| 7-Zip | `application/x-7z-compressed` |
| TAR | `application/x-tar` |
| GZIP | `application/gzip` |

## MIME Type Categories

For broader searches, you can use wildcards:

- **Documents**: `mimeType contains 'application/vnd.openxmlformats' or mimeType contains 'application/vnd.google-apps.document'`
- **Images**: `mimeType contains 'image/'`
- **Videos**: `mimeType contains 'video/'`
- **Audio**: `mimeType contains 'audio/'`
- **Google Workspace**: `mimeType contains 'application/vnd.google-apps'`
- **Non-Google files**: `not mimeType contains 'application/vnd.google-apps'`

## Note on Google Workspace Files

Google Workspace files (Docs, Sheets, Slides, etc.) don't have a traditional file size since they're stored as structured data. When you download them, you must export to a standard format.
