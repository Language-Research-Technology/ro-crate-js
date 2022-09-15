const utils = require('./utils');

const $target = Symbol('target');
const $owner = Symbol('owner');
const $node = Symbol('node');
//const $toJSON = Symbol('toJSON');
const $proxy = Symbol('proxy');
const $noderef = Symbol('noderef');
const Symbols = { $target, $owner, $node, $proxy, $noderef };

/**
 * @typedef {{'@id':string,'@reverse':object}} NodeRef 
 * @typedef {{'@id':string, [key: string]: any}} RawEntity
 * @typedef {RawEntity & {toJSON(): RawEntity}} Entity
 */

/**
 * JSON-LD Node Object
 * @implements {Entity}
 */
class Node {

  /** 
   * Node reference: A node object used to reference a node having only the @id key.
   * @type {NodeRef} 
   */
  #ref;

  /**
   * 
   * @param {NodeRef} ref
   */
  constructor(ref) {
    if (!ref['@id']) throw new Error('A JSON-LD node must have @id');
    this.#ref = ref;
    //Object.defineProperty(this.#ref, $node, { value: this });
  }

  set ['@id'](id) {
    this.#ref['@id'] = id;
  }
  get ['@id']() {
    return this.#ref['@id'];
  }
  get ['@reverse']() {
    return this.#ref['@reverse'];
  }
  get [$noderef]() {
    return this.#ref;
  }

  /**
   * Return a deep copy of the entity in plain JS object
   */
  toJSON() {
    let t = this[$target] || this;
    let o = { '@id': t['@id'] };
    for (const key in t) {
      o[key] = structuredClone(t[key]);
    }
    // let o = structuredClone(t);
    // o['@id'] = t['@id'];
    return o;
  }

  /**
   * Check if an entity has the specified type.
   * @param {*} type 
   * @returns {boolean}
   */
  $$hasType(type) {
    return utils.asArray(this["@type"]).includes(type);
  }

  /**
   * 
   * @param {string} prop 
   * @return {Array}
   */
  $$getAsArray(prop) {
    return utils.asArray(this[prop]);
  }
}


/**
 * @typedef {Object} EntityCollection
 * @property {function(string):*} getEntity - Get entity by id
 * @property {function(object, string, *):*} setProperty - Set entity's property
 * @property {{resolveLinks?:boolean, alwaysAsArray?:boolean}} config - Config
 */



class Handler {
  /**
   * 
   * @param {EntityCollection} owner 
   */
  constructor(owner) {
    this.owner = owner;
  }

  /**
   * 
   * @param {Node} target 
   * @param {*} prop 
   * @returns 
   */
  get(target, prop) {
    const owner = this.owner;
    switch (prop) {
      case $target: return target;
      case $owner: return owner;
      case $noderef: return target[$noderef];
      case $node: return function (owner_) { if (owner === owner_) return target; };
      case '@id': return target[prop];
      case '@reverse': return new Proxy(target[prop], this);
      //case 'toJSON': return Node.prototype[$toJSON];
      default:
        if (typeof target.constructor.prototype[prop] === 'function') return target.constructor.prototype[prop];
        if (prop in target) {
          let val = target[prop];
          if (typeof val === 'function') return val;
          const { resolveLinks, alwaysAsArray } = owner.config;
          let vals = utils.asArray(val).map(v => (v?.["@id"] && resolveLinks) ? owner.getEntity(v["@id"]) || v : v);
          return (vals.length > 1 || alwaysAsArray) ? vals : vals[0];
        }
    }
  }

  set(target, prop, value) {
    if (prop in { toJSON: 0 }) return false;
    this.owner.setProperty(target, prop, value);
    return true;
  }

  getOwnPropertyDescriptor(target, prop) {
    if (prop === '@id') return { configurable: true, enumerable: true, writable: true }; //value: target[prop] 
    else return Reflect.getOwnPropertyDescriptor(target, prop);
  }

  ownKeys(target) {
    return ['@id'].concat(Object.getOwnPropertyNames(target));
  }
}


module.exports = { Node, Handler, Symbols };
