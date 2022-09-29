
export type RawEntity = {
  '@id': string
  [key: string]: any
}

export type Entity = {
  '@id': string
  '@reverse':object
  toJSON(): RawEntity
  [key: string]: any
}
