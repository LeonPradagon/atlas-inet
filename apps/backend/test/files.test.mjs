import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { parseAssetFile } from '../dist/modules/imports/import-parser.js'
import { parseBulkFile } from '../dist/modules/jobs/bulk-parser.js'
import { readWorkbook,spreadsheet } from '../dist/modules/files/tabular-files.js'
const file=(name,buffer) => ({ originalname:name,buffer,size:buffer.length,mimetype:name.endsWith('.kml') ? 'application/vnd.google-earth.kml+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
test('KML namespace/folder traversal separates ODC, ODP and lines without invented metadata',async () => {
  const buffer=Buffer.from(`<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document><k:Folder>
    <k:Placemark id="line"><k:name>Test line</k:name><k:LineString><k:coordinates>106.8,-6.2,0 106.9,-6.2,0</k:coordinates></k:LineString></k:Placemark>
    <k:Placemark id="odc"><k:Point><k:coordinates>106.8,-6.2</k:coordinates></k:Point></k:Placemark>
    <k:Placemark id="odp"><k:Point><k:coordinates>106.9,-6.2</k:coordinates></k:Point></k:Placemark>
  </k:Folder></k:Document></k:kml>`)
  const result=await parseAssetFile(file('test.kml',buffer),{ '2':{ kind:'ODC' },'3':{ kind:'ODP' } })
  assert.deepEqual(result.errors,[])
  assert.deepEqual(result.rows.map((r) => r.kind),['SEGMENT','ODC','ODP'])
  assert.equal(result.rows[0].installedCoreCount,undefined)
})
test('KML rejects zero length, empty coordinates, mixed geometry and unmapped identity',async () => {
  for (const shape of ['<LineString><coordinates>106,0 106,0</coordinates></LineString>','<Point><coordinates>,0</coordinates></Point>','<Point><coordinates>106,0</coordinates></Point><LineString><coordinates>106,0 107,1</coordinates></LineString>','<MultiGeometry><Point><coordinates>106,0</coordinates></Point><LineString><coordinates>106,0 107,1</coordinates></LineString></MultiGeometry>']) {
    const result=await parseAssetFile(file('bad.kml',Buffer.from(`<kml><Placemark id="bad"><name>Test</name>${shape}</Placemark></kml>`)),{ '1':{ kind:shape.startsWith('<Point>') ? 'ODP' : 'SEGMENT' } })
    assert.equal(result.errors.length,1,shape)
  }
  const result=await parseAssetFile(file('unmapped.kml',Buffer.from('<kml><Placemark><name>Test</name><LineString><coordinates>106,0 107,1</coordinates></LineString></Placemark></kml>')))
  assert.equal(result.errors.length,1)
})
test('Excel rejects formula/hyperlink cells, duplicate references and text coordinates per row',async () => {
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Input')
  sheet.addRow(['reference_id','address','latitude','longitude'])
  sheet.addRow(['A','',-6.2,106.8]);sheet.addRow(['A','',-6.2,106.8])
  sheet.addRow(['B','', '-6.2',106.8]);sheet.addRow(['C',{ formula:'1+1',result:2 },null,null])
  sheet.addRow(['D',{ text:'click',hyperlink:'https://example.test' },null,null])
  const rows=await parseBulkFile(file('input.xlsx',Buffer.from(await workbook.xlsx.writeBuffer())),'11111111-1111-4111-8111-111111111111')
  assert.equal(rows.filter((r) => !r.error).length,1)
  assert.equal(rows.filter((r) => r.error).length,4)
})
test('XLSX container and headers are validated before processing',async () => {
  await assert.rejects(readWorkbook(file('bad.xlsx',Buffer.from('not a zip')),'Input'),/Invalid XLSX archive/)
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Input')
  sheet.addRow(['address','address']);sheet.addRow(['test','test'])
  await assert.rejects(readWorkbook(file('duplicate.xlsx',Buffer.from(await workbook.xlsx.writeBuffer())),'Input'),/unique/)
  const buffer=await spreadsheet([{ name:'Assets',columns:['kind','code'],rows:[{ kind:'ODP',code:'test' }] }])
  await assert.rejects(readWorkbook(file('wrong.xlsx',buffer),'Input'),/Expected Input sheet/)
})
test('address-only point assets stage for geocoding; coordinates bypass it; segment paths are never invented',async () => {
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Assets')
  sheet.addRow(['kind','external_id','code','address','latitude','longitude','geometry','height_m','cable_name'])
  sheet.addRow(['ODP','address-point','ODP-T','Synthetic address'])
  sheet.addRow(['NODE','coordinates','NODE-T','Metadata only',-6.2,106.8])
  sheet.addRow(['SEGMENT','address-line','LINE-T','Synthetic address',null,null,null,null,'Synthetic cable'])
  sheet.addRow(['ODP','broken-geometry','ODP-B','Synthetic address',null,null,'broken'])
  sheet.addRow(['ODP','partial','ODP-P','Synthetic address',-6.2])
  sheet.addRow(['POLE','invalid-pole','POLE-T','Synthetic address'])
  const result=await parseAssetFile(file('points.xlsx',Buffer.from(await workbook.xlsx.writeBuffer())))
  assert.equal(result.rows.length,1);assert.equal(result.errors.length,5)
  assert.deepEqual(result.rows[0].geometry,{ type:'Point',coordinates:[106.8,-6.2] })
  assert.equal(result.errors[0].code,'ADDRESS_NEEDS_GEOCODING');assert.equal(result.errors[0].sourceRow.address,'Synthetic address')
  assert.match(result.errors[1].message,/geometri garis aktual/)
  for (const error of result.errors.slice(1)) assert.equal(error.sourceRow,undefined)
  const kml=await parseAssetFile(file('address.kml',Buffer.from('<kml><Placemark id="odp-address"><address>Synthetic address</address></Placemark></kml>')),{ '1':{ kind:'ODP' } })
  assert.equal(kml.rows.length,0);assert.equal(kml.errors[0].code,'ADDRESS_NEEDS_GEOCODING')
  const unknown=await parseAssetFile(file('address.kml',Buffer.from('<kml><Placemark id="unknown"><address>Synthetic address</address></Placemark></kml>')))
  assert.equal(unknown.errors[0].sourceRow,undefined)
  const spoof=await parseAssetFile(file('address.kml',Buffer.from('<kml><Placemark id="odp-address"><address>Synthetic address</address></Placemark></kml>')),{ '1':{ kind:'ODP',geocoding:{ provider:'fake' } } })
  assert.match(spoof.errors[0].message,/server-owned/)
  const malformed=await parseAssetFile(file('address.kml',Buffer.from('<kml><Placemark id="odp-address"><address>Synthetic address</address><MultiGeometry/></Placemark></kml>')),{ '1':{ kind:'ODP' } })
  assert.equal(malformed.errors[0].sourceRow,undefined)
  assert.match(malformed.errors[0].message,/MultiGeometry/)
})
test('bulk accepts address-only rows and optional validated connection point without breaking old templates',async () => {
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Input')
  sheet.addRow(['reference_id','address','connection_point_id'])
  const point='11111111-1111-4111-8111-111111111111'
  sheet.addRow(['A','Synthetic address',point]);sheet.addRow(['B','Synthetic address','not-a-uuid']);sheet.addRow(['C','Synthetic address'])
  const rows=await parseBulkFile(file('address.xlsx',Buffer.from(await workbook.xlsx.writeBuffer())),point)
  assert.equal(rows[0].error,null);assert.equal(rows[0].input.analysis.connectionPointId,point)
  assert.ok(rows[1].error);assert.equal(rows[2].error,null);assert.equal(rows[2].input.analysis.latitude,undefined)
})
