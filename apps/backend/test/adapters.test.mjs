import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { InternalAdapters } from '../dist/modules/analysis/internal-adapters.js'
test('approved internal adapters distinguish unavailable, missing, ambiguous and valid results',async () => {
  const server=createServer((req,res) => {
    const chunks=[]
    req.on('data',(chunk) => chunks.push(chunk))
    req.on('end',() => {
      const { address }=JSON.parse(Buffer.concat(chunks).toString())
      if (address==='fail') { res.writeHead(503);res.end();return }
      if (address==='redirect') { res.writeHead(302,{ Location:'http://example.test' });res.end();return }
      if (address==='oversized') { res.end('x'.repeat(1_000_001));return }
      res.setHeader('Content-Type','application/json')
      const candidate={ latitude:-6.2,longitude:106.8,label:'Synthetic test point' }
      res.end(JSON.stringify({ candidates:address==='missing' ? [] : address==='ambiguous' ? [candidate,candidate] : address==='invalid' ? [{ ...candidate,latitude:91 }] : [candidate] }))
    })
  })
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve))
  try {
    const absent=new InternalAdapters({})
    assert.equal((await absent.geocode('test')).status,'GEOCODING_NOT_CONFIGURED')
    assert.equal(await absent.route({},{}),null)
    const adapter=new InternalAdapters({ geocodingInternalUrl:`http://127.0.0.1:${server.address().port}` })
    assert.equal((await adapter.geocode('missing')).status,'ADDRESS_NOT_FOUND')
    assert.equal((await adapter.geocode('ambiguous')).status,'AMBIGUOUS_ADDRESS')
    assert.equal((await adapter.geocode('valid')).status,'OK')
    for (const address of ['invalid','fail','redirect','oversized']) assert.equal((await adapter.geocode(address)).status,'GEOCODING_UNAVAILABLE')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
test('Photon internal queries Indonesia only, preserves lon/lat and asks confirmation for ambiguous/coarse results',async () => {
  const queries=[]
  const server=createServer((req,res) => {
    const url=new URL(req.url,'http://127.0.0.1')
    queries.push({ method:req.method,pathname:url.pathname,query:Object.fromEntries(url.searchParams) })
    const q=url.searchParams.get('q')
    if (q==='fail') { res.writeHead(503);res.end();return }
    const feature={ type:'Feature',geometry:{ type:'Point',coordinates:[106.8,-6.2] },properties:{ countrycode:'ID',name:'Synthetic building',street:'Test street',housenumber:'7',city:'Test city',osm_value:'house' } }
    const coarse={ ...feature,properties:{ ...feature.properties,housenumber:undefined,osm_value:'city' } }
    const invalid={ ...feature,geometry:{ type:'Point',coordinates:[181,-6.2] } }
    const foreign={ ...feature,properties:{ ...feature.properties,countrycode:'SG' } }
    res.setHeader('Content-Type','application/json')
    res.end(JSON.stringify({ features:q==='none' ? [] : q==='foreign' ? [foreign] : q==='ambiguous' ? [feature,coarse] : q==='coarse' ? [coarse] : q==='invalid' ? [invalid] : [feature] }))
  })
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve))
  try {
    const adapter=new InternalAdapters({ photonInternalUrl:`http://127.0.0.1:${server.address().port}`,geocodingDatasetVersion:'synthetic-v1' })
    const result=await adapter.geocode('Alamat & bukan parameter tambahan')
    assert.equal(result.status,'OK');assert.equal(result.candidate.latitude,-6.2);assert.equal(result.candidate.longitude,106.8)
    assert.equal(result.provider,'PHOTON_INTERNAL');assert.equal(result.datasetVersion,'synthetic-v1')
    assert.deepEqual(queries[0],{ method:'GET',pathname:'/api',query:{ q:'Alamat & bukan parameter tambahan',countrycode:'ID',limit:'5' } })
    assert.equal((await adapter.geocode('ambiguous')).status,'AMBIGUOUS_ADDRESS')
    const coarse=await adapter.geocode('coarse');assert.equal(coarse.status,'AMBIGUOUS_ADDRESS');assert.equal(coarse.candidates[0].precision,'city')
    for (const value of ['none','foreign']) assert.equal((await adapter.geocode(value)).status,'ADDRESS_NOT_FOUND')
    for (const value of ['fail','invalid']) assert.equal((await adapter.geocode(value)).status,'GEOCODING_UNAVAILABLE')
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
