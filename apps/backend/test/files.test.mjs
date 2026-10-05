import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import { parseAssetFile } from '../dist/modules/imports/import-parser.js'
import { parseBulkFile } from '../dist/modules/jobs/bulk-parser.js'
import { readWorkbook,spreadsheet,validateUpload } from '../dist/modules/files/tabular-files.js'
const file=(name,buffer) => ({ originalname:name,buffer,size:buffer.length,mimetype:name.endsWith('.kml') ? 'application/vnd.google-earth.kml+xml' : name.endsWith('.kmz') ? 'application/vnd.google-earth.kmz' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
function kmz(name,content) {
  const filename=Buffer.from(name),plain=Buffer.from(content),compressed=deflateRawSync(plain)
  let crc=0xffffffff
  for (const byte of plain) { crc^=byte;for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0) }
  crc=(crc^0xffffffff)>>>0
  const local=Buffer.alloc(30+filename.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(filename.length,26);filename.copy(local,30)
  const central=Buffer.alloc(46+filename.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0,8);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(plain.length,24);central.writeUInt16LE(filename.length,28);filename.copy(central,46)
  const centralOffset=local.length+compressed.length,end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(centralOffset,16)
  return Buffer.concat([local,compressed,central,end])
}
test('KML namespace/folder traversal separates ODC, ODP and lines without invented metadata',async () => {
  const buffer=Buffer.from(`<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document><k:Folder>
    <k:Placemark id="line"><k:name>Test line</k:name><k:LineString><k:coordinates>106.8,-6.2,0 106.9,-6.2,0</k:coordinates></k:LineString></k:Placemark>
    <k:Placemark id="odc"><k:Point><k:coordinates>106.8,-6.2</k:coordinates></k:Point></k:Placemark>
    <k:Placemark id="odp"><k:Point><k:coordinates>106.9,-6.2</k:coordinates></k:Point></k:Placemark>
  </k:Folder></k:Document></k:kml>`)
  const result=await parseAssetFile(file('test.kml',buffer),{ '2':{ kind:'ODC' },'3':{ kind:'ODP' } })
  assert.deepEqual(result.errors,[])
  assert.deepEqual(result.rows.map((r) => r.kind),['SEGMENT','ODC','ODP'])
  assert.equal(result.referenceFeatures.length,3)
  assert.ok(result.referenceFeatures.every((feature) => feature.assetRowValid))
  assert.equal(result.rows[0].installedCoreCount,undefined)
})
test('KML rejects invalid geometry and stages valid unmapped geometry as reference',async () => {
  for (const shape of ['<LineString><coordinates>106,0 106,0</coordinates></LineString>','<Point><coordinates>,0</coordinates></Point>','<Point><coordinates>106,0</coordinates></Point><LineString><coordinates>106,0 107,1</coordinates></LineString>','<MultiGeometry><Point><coordinates>106,0</coordinates></Point><LineString><coordinates>106,0 107,1</coordinates></LineString></MultiGeometry>']) {
    const result=await parseAssetFile(file('bad.kml',Buffer.from(`<kml><Placemark id="bad"><name>Test</name>${shape}</Placemark></kml>`)),{ '1':{ kind:shape.startsWith('<Point>') ? 'ODP' : 'SEGMENT' } })
    assert.equal(result.errors.length,1,shape)
  }
  const result=await parseAssetFile(file('unmapped.kml',Buffer.from('<kml><Placemark><name>Test</name><LineString><coordinates>106,0 107,1</coordinates></LineString></Placemark></kml>')))
  assert.equal(result.errors.length,0)
  assert.equal(result.referenceFeatures.length,1)
  assert.equal(result.referenceFeatures[0].geometry.type,'LineString')
})
test('KML reference features preserve placemark properties, styles and folder path for map details',async () => {
  const xml='<kml><Document><name>FTTH ALL</name><Folder><name>POP BANJARSARI</name><Placemark id="point-a17"><name>A17</name><Style><LabelStyle><color>ff00ffff</color><scale>0.7</scale></LabelStyle><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle></Style><ExtendedData><Data name="label-opacity"><value>1</value></Data><Data name="treeId"><value>placemark-xhr9wha03</value></Data></ExtendedData><Point><coordinates>105.98925,-6.62356,0</coordinates></Point></Placemark></Folder></Document></kml>'
  const result=await parseAssetFile(file('details.kml',Buffer.from(xml)))
  assert.equal(result.referenceFeatures.length,1)
  assert.deepEqual(result.referenceFeatures[0].properties,{
    'label-opacity':'1',treeId:'placemark-xhr9wha03','label-color':'#ffff00','label-scale':'0.7',
    icon:'http://maps.google.com/mapfiles/kml/shapes/placemark_square.png',kmlFolderPath:'FTTH ALL/POP BANJARSARI',name:'A17',
  })
})
test('KML Polygon and polygon-only MultiGeometry stage as non-operational reference areas',async () => {
  const xml=`<kml><Document>
    <Placemark id="district"><name>District</name><Polygon>
      <outerBoundaryIs><LinearRing><coordinates>106,-6 107,-6 107,-7 106,-7 106,-6</coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>106.2,-6.2 106.2,-6.4 106.4,-6.4 106.4,-6.2 106.2,-6.2</coordinates></LinearRing></innerBoundaryIs>
    </Polygon></Placemark>
    <Placemark id="zones"><name>Zones</name><MultiGeometry>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>108,-6 109,-6 109,-7 108,-7 108,-6</coordinates></LinearRing></outerBoundaryIs></Polygon>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>110,-6 111,-6 111,-7 110,-7 110,-6</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </MultiGeometry></Placemark>
  </Document></kml>`
  const result=await parseAssetFile(file('areas.kml',Buffer.from(xml)))
  assert.equal(result.errors.length,0)
  assert.equal(result.rows.length,0)
  assert.equal(result.areas.length,2)
  assert.deepEqual(result.areas[0].geometry,{type:'Polygon',coordinates:[[[106,-6],[107,-6],[107,-7],[106,-7],[106,-6]],[[106.2,-6.2],[106.2,-6.4],[106.4,-6.4],[106.4,-6.2],[106.2,-6.2]]]})
  assert.equal(result.areas[1].geometry.type,'MultiPolygon')
})
test('KML invalid Polygon ring remains an import error',async () => {
  const xml='<kml><Placemark id="open"><name>Open boundary</name><Polygon><outerBoundaryIs><LinearRing><coordinates>106,-6 107,-6 107,-7 106,-7</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>'
  const result=await parseAssetFile(file('open.kml',Buffer.from(xml)))
  assert.equal(result.areas.length,0)
  assert.equal(result.errors.length,1)
  assert.match(result.errors[0].message,/closed/)
})
test('analysis KML accepts point/address placemarks, rejects network lines and requires typed connection points',async () => {
  const point='11111111-1111-4111-8111-111111111111'
  const xml=`<kml><Document>
    <Placemark><name>A</name><Point><coordinates>106.8,-6.2,0</coordinates></Point><ExtendedData><Data name="connection_point_id"><value>${point}</value></Data><Data name="connection_point_type"><value>ODP</value></Data></ExtendedData></Placemark>
    <Placemark><name>B</name><address>Synthetic address</address></Placemark>
    <Placemark><name>C</name><LineString><coordinates>106.8,-6.2 106.9,-6.2</coordinates></LineString></Placemark>
    <Placemark><name>A</name><Point><coordinates>106.9,-6.2</coordinates></Point></Placemark>
    <Placemark><name>D</name><Point><coordinates>106.9,-6.2</coordinates></Point><ExtendedData><Data name="connection_point_id"><value>${point}</value></Data></ExtendedData></Placemark>
  </Document></kml>`
  const rows=await parseBulkFile(file('input.kml',Buffer.from(xml)),'11111111-1111-4111-8111-111111111111')
  assert.equal(rows[0].error,null);assert.equal(rows[0].input.analysis.connectionPointType,'ODP');assert.equal(rows[0].input.analysis.latitude,-6.2)
  assert.equal(rows[1].error,null);assert.equal(rows[1].input.analysis.address,'Synthetic address')
  assert.match(rows[2].error,/Point placemarks/);assert.match(rows[3].error,/Duplicate/);assert.match(rows[4].error,/provided together/)
  assert.throws(() => validateUpload(file('input.xlsx',Buffer.from('not kml'))),/Only .kml or .kmz/)
})
test('KMZ upload securely reads its KML document for point previews',async () => {
  const xml='<kml><Document><Placemark><name>KMZ-POINT</name><Point><coordinates>106.8,-6.2</coordinates></Point></Placemark></Document></kml>'
  const rows=await parseBulkFile(file('point.kmz',kmz('doc.kml',xml)),'11111111-1111-4111-8111-111111111111')
  assert.equal(rows.length,1);assert.equal(rows[0].error,null);assert.equal(rows[0].input.analysis.longitude,106.8)
})
test('XLSX container and headers are validated before processing',async () => {
  await assert.rejects(readWorkbook(file('bad.xlsx',Buffer.from('not a zip')),'Input'),/Invalid XLSX archive/)
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Input')
  sheet.addRow(['address','address']);sheet.addRow(['test','test'])
  await assert.rejects(readWorkbook(file('duplicate.xlsx',Buffer.from(await workbook.xlsx.writeBuffer())),'Input'),/unique/)
  const buffer=await spreadsheet([{ name:'Assets',columns:['kind','code'],rows:[{ kind:'ODP',code:'test' }] }])
  await assert.rejects(readWorkbook(file('wrong.xlsx',buffer),'Input'),/Expected Input sheet/)
})
test('KML address-only point assets stage for geocoding; actual geometry is never invented',async () => {
  const xml=`<kml><Document>
    <Placemark id="address-point"><name>ODP-T</name><address>Synthetic address</address></Placemark>
    <Placemark id="coordinates"><name>NODE-T</name><Point><coordinates>106.8,-6.2</coordinates></Point></Placemark>
    <Placemark id="address-line"><name>Synthetic cable</name><address>Synthetic address</address></Placemark>
    <Placemark id="broken-geometry"><name>ODP-B</name><Point><coordinates>,0</coordinates></Point></Placemark>
    <Placemark id="partial"><name>ODP-P</name><Point><coordinates>106.8</coordinates></Point></Placemark>
    <Placemark id="invalid-pole"><name>POLE-T</name><Point><coordinates>106.8,-6.2</coordinates></Point></Placemark>
  </Document></kml>`
  const mappings={ '1':{ kind:'ODP',code:'ODP-T' },'2':{ kind:'NODE' },'3':{ kind:'SEGMENT',cableName:'Synthetic cable' },'4':{ kind:'ODP' },'5':{ kind:'ODP' },'6':{ kind:'POLE' } }
  const result=await parseAssetFile(file('points.kml',Buffer.from(xml)),mappings)
  assert.equal(result.rows.length,1);assert.equal(result.errors.length,4);assert.equal(result.referenceFeatures.length,2)
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
