import { BadRequestException } from '@nestjs/common'
import ExcelJS from 'exceljs'
import yauzl from 'yauzl'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export interface UploadFile { originalname: string; mimetype: string; buffer: Buffer; size: number }
export const uploadLimits = { fileSize: 20 * 1024 * 1024, files: 1, fields: 8, fieldSize: 512 * 1024 }
export const analysisUploadLimits = { ...uploadLimits, fileSize: 50 * 1024 * 1024 }
export const analysisExcelRowLimit = 50_000
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

export function validateUpload(file: UploadFile | undefined, allowExcel = false): UploadFile {
  const maxSize = allowExcel && /\.xlsx$/i.test(file?.originalname ?? '') ? analysisUploadLimits.fileSize : uploadLimits.fileSize
  if (!file || !file.buffer?.length || file.buffer.length > maxSize) throw new BadRequestException(`A file of at most ${maxSize / 1024 / 1024} MB is required`)
  if (file.originalname.length > 200 || /[\x00-\x1f]/.test(file.originalname)) throw new BadRequestException('Invalid upload filename')
  const extension = allowExcel ? /\.(kml|kmz|xlsx)$/i : /\.(kml|kmz)$/i
  if (!extension.test(file.originalname)) throw new BadRequestException(allowExcel ? 'Only .xlsx, .kml or .kmz upload files are supported' : 'Only .kml or .kmz upload files are supported')
  return file
}

async function extractKmzKml(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new BadRequestException('Invalid KMZ archive'))
      let count = 0
      let expanded = 0
      let kml: Buffer | null = null
      let settled = false
      const names = new Set<string>()
      const fail = (message = 'Unsafe or oversized KMZ archive') => {
        if (settled) return
        settled = true
        zip.close()
        reject(new BadRequestException(message))
      }
      zip.on('error', () => fail('Invalid KMZ archive'))
      zip.on('end', () => {
        if (settled) return
        settled = true
        if (!kml) reject(new BadRequestException('KMZ must contain exactly one KML document'))
        else resolve(kml)
      })
      zip.on('entry', (entry: yauzl.Entry) => {
        count++
        expanded += entry.uncompressedSize
        const pathParts = entry.fileName.split(/[\\/]+/)
        if (count > 512 || expanded > 64 * 1024 * 1024 || entry.uncompressedSize > 32 * 1024 * 1024
          || entry.isEncrypted() || entry.fileName.startsWith('/') || /^[a-z]:/i.test(entry.fileName)
          || pathParts.includes('..') || names.has(entry.fileName)) return fail()
        names.add(entry.fileName)
        if (!/\.kml$/i.test(entry.fileName)) return zip.readEntry()
        if (kml) return fail('KMZ must contain exactly one KML document')
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return fail('Cannot read KML document inside KMZ')
          const chunks: Buffer[] = []
          let size = 0
          stream.on('error', () => fail('Cannot read KML document inside KMZ'))
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 32 * 1024 * 1024) { stream.destroy(); fail() }
            else chunks.push(chunk)
          })
          stream.on('end', () => {
            if (settled) return
            kml = Buffer.concat(chunks)
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

export async function readKmlDocument(file: UploadFile): Promise<Record<string, unknown>> {
  const isKmz = /\.kmz$/i.test(file.originalname)
  const allowedTypes = isKmz
    ? ['application/vnd.google-earth.kmz', 'application/zip', 'application/octet-stream']
    : ['application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml', 'application/octet-stream']
  if (!allowedTypes.includes(file.mimetype)) throw new BadRequestException(`Invalid ${isKmz ? 'KMZ' : 'KML'} content type`)
  let buffer = file.buffer
  if (isKmz) buffer = await extractKmzKml(buffer)
  if (buffer.length > 32 * 1024 * 1024) throw new BadRequestException('KML document exceeds 32 MB')
  let text: string
  try { text = new TextDecoder('utf8', { fatal: true }).decode(buffer) } catch { throw new BadRequestException('KML must be UTF-8') }
  if (/<!\s*(DOCTYPE|ENTITY)\b|\u0000/i.test(text) || XMLValidator.validate(text) !== true) throw new BadRequestException('Unsafe or invalid KML XML')
  try { return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(text) as Record<string, unknown> }
  catch { throw new BadRequestException('Cannot parse KML document') }
}

export async function readWorkbook(file: UploadFile, sheetName: string, maxRows = 10_000) {
  if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Expected .xlsx file')
  if (!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'application/zip'].includes(file.mimetype)) throw new BadRequestException('Invalid XLSX content type')
  await inspectArchive(file.buffer)
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer) } catch { throw new BadRequestException('Cannot read XLSX workbook') }
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet || sheet.rowCount > maxRows + 1 || sheet.columnCount > 30) throw new BadRequestException(`Expected ${sheetName} sheet with at most ${maxRows.toLocaleString('en-US')} rows and 30 columns`)
  const names = Array.from({ length: sheet.columnCount }, (_, index) => {
    const value = sheet.getRow(1).getCell(index + 1).value
    return typeof value === 'string' ? value.trim() : ''
  })
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
