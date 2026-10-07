export function prioritizeMapFeature<T extends { geometry: { type: string } }>(features: readonly T[]): T | undefined {
  return features.find((feature) => feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint')
    ?? features.find((feature) => feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')
    ?? features.find((feature) => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
    ?? features[0]
}
