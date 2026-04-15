export type NodeRef = {
  '@id': string
  '@reverse': {[key: string]: any}
}

export type RawEntity = {
  '@id': string
  [key: string]: any
}

export type Entity = {
  '@id': string
  '@reverse': {[key: string]: any}
  toJSON(): RawEntity
  [key: string]: any
}
