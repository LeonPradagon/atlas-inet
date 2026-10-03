import { BadRequestException } from '@nestjs/common'
import ExcelJS from 'exceljs'
import yauzl from 'yauzl'

export interface UploadFile { originalname: string; mimetype: string; buffer: Buffer; size: number }
export const uploadLimits = { fileSize: 20 * 1024 * 1024, files: 1, fields: 8, fieldSize: 512 * 1024 }
export type Cell = string | number | boolean | null

async function inspectArchive(buffer: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new BadRequestException('Invalid XLSX archive'))
      let count = 0
      let declared = 0
      let actual = 0
      const names = new Set<string>()
      let settled = false
      const fail = () => { if (!settled) { settled = true; zip.close(); reject(new BadRequestException('Unsafe or oversized XLSX archive')) } }
      zip.on('error', fail)
      zip.on('end', () => {
        if (settled) return
        settled = true
        if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) reject(new BadRequestException('Expected XLSX workbook'))
        else resolve()
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        count++
        declared += entry.uncompressedSize
        if (count > 2000 || declared > 100 * 1024 * 1024 || entry.uncompressedSize > 64 * 1024 * 1024 || entry.isEncrypted()
          || names.has(entry.fileName) || /(^\/|\.\.|\\|vbaProject|externalLinks)/i.test(entry.fileName)) return fail()
        names.add(entry.fileName)
        if (entry.fileName.endsWith('/')) return zip.readEntry()
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail()
          const chunks: Buffer[] = []
          stream.on('error', fail)
          stream.on('data', (chunk: Buffer) => {
            actual += chunk.length
            if (actual > 100 * 1024 * 1024) { stream.destroy(); fail() }
            else if (/\.xml$/i.test(entry.fileName)) chunks.push(chunk)
          })
          stream.on('end', () => {
            if (settled) return
            if (chunks.length && /<!\s*(DOCTYPE|ENTITY)\b/i.test(Buffer.concat(chunks).toString('utf8'))) return fail()
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

export function validateUpload(file: UploadFile | undefined): UploadFile {
  if (!file || !file.buffer?.length || file.buffer.length > uploadLimits.fileSize) throw new BadRequestException('A file of at most 20 MB is required')
  if (file.originalname.length > 200 || /[\x00-\x1f]/.test(file.originalname)) throw new BadRequestException('Invalid upload filename')
  if (!/\.(xlsx|kml)$/i.test(file.originalname)) throw new BadRequestException('Only .xlsx or .kml files are supported')
  return file
}

export async function readWorkbook(file: UploadFile, sheetName: string) {
  if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Expected .xlsx file')
  if (!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'application/zip'].includes(file.mimetype)) throw new BadRequestException('Invalid XLSX content type')
  await inspectArchive(file.buffer)
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer) } catch { throw new BadRequestException('Cannot read XLSX workbook') }
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet || sheet.rowCount > 10_001 || sheet.columnCount > 30) throw new BadRequestException(`Expected ${sheetName} sheet with at most 10,000 rows and 30 columns`)
  const headers = sheet.getRow(1).values as ExcelJS.CellValue[]
  const names = headers.slice(1).map((value) => typeof value === 'string' ? value.trim() : '')
  if (names.some((name) => !name) || new Set(names).size !== names.length) throw new BadRequestException('Headers must be nonempty and unique')
  const rows: { rowNumber: number; values: Record<string, Cell>; error?: string }[] = []
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number)
    const values: Record<string, Cell> = {}
    let error: string | undefined
    for (let i = 0; i < names.length; i++) {
      const value = row.getCell(i + 1).value
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[names[i]] = value
      else { values[names[i]] = null; error = 'Formulas, hyperlinks, rich text and complex cell values are not accepted' }
    }
    if (Object.values(values).every((value) => value === null || value === '')) continue
    rows.push({ rowNumber: number, values, ...(error ? { error } : {}) })
  }
  if (!rows.length) throw new BadRequestException('Workbook has no input rows')
  return { headers: names, rows }
}

export async function spreadsheet(sheets: { name: string; columns: string[]; rows: Record<string, unknown>[] }[]) {
  const workbook = new ExcelJS.Workbook()
  for (const input of sheets) {
    const sheet = workbook.addWorksheet(input.name)
    sheet.addRow(input.columns)
    for (const record of input.rows) {
      sheet.addRow(input.columns.map((key) => {
        const value = record[key]
        if (typeof value === 'number' || typeof value === 'boolean') return value
        // Explicit strings are serialized as shared strings, never formulas.
        return value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
      }))
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
