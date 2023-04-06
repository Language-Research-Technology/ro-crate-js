const {Utils} = require('./utils');

const $target = Symbol('target');
const $owner = Symbol('owner');
const $node = Symbol('node');
//const $toJSON = Symbol('toJSON');
const $proxy = Symbol('proxy');
const $noderef = Symbol('noderef');
const Symbols = { $target, $owner, $node, $proxy, $noderef };

/**
 * @typedef {import('./types').NodeRef} NodeRef
 * @typedef {import('./types').Entity} Entity
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
      o[key] = Utils.clone(t[key]);
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
    return Utils.asArray(this["@type"]).includes(type);
  }

  /**
   * 
   * @param {string} prop 
   * @return {Array}
   */
  $$getAsArray(prop) {
    return Utils.asArray(this[prop]);
  }
}


/**
 * @typedef {Object} EntityCollection
 * @property {function(object, string):*} getProperty - Get entity's property
 * @property {function(object, string, *):*} setProperty - Set entity's property
 * @property {function(object, string):*} deleteProperty - Delete entity's property
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
      case $node: return function (owner_) { return owner === owner_ ? target : null; };
      //case '@id': return target[prop];
      //case '@reverse': return new Proxy(target[prop], this);
      //case 'toJSON': return Node.prototype[$toJSON];
      default:
        let pd = Object.getOwnPropertyDescriptor(target.constructor.prototype, prop);
        if (typeof pd?.value === 'function') return target.constructor.prototype[prop].bind(target);
        return owner.getProperty(target, prop);
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

  deleteProperty(target, prop) {
    return !!this.owner.deleteProperty(target, prop);
  }
}

const arrayFunctions = {};
for (const key of ['push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'sort']) {
  arrayFunctions[key] = function(...args) {
    var res = this[key](...args);

  }
}

/**
 * Proxy to wrap an array returned by an entity property 
 */
class ArrayHandler {
  /**
   * 
   * @param {Node} owner The entity that owns the array
   */
  constructor(owner, prop) {
    this.owner = owner;
    this.ownerProp = prop;
  }

  /**
   * 
   * @param {Array} target 
   * @param {PropertyKey} prop 
   * @returns 
   */
  get(target, prop, receiver) {
    //console.log(target, prop, receiver);
    const owner = this.owner;
    const ownerProp = this.ownerProp;
    switch (prop) {
      case $target: return target;
      case $owner: return owner;
      case 'push': case 'pop': case 'shift': case 'unshift': case 'splice': case 'reverse': case 'sort':
        return function(...args) {
          var res = target[prop](...args);
          owner[ownerProp] = target;
          return res;
        };
      default:
        //let pd = Object.getOwnPropertyDescriptor(target.constructor.prototype, prop);
        //if (typeof pd?.value === 'function') return target.constructor.prototype[prop];
        //return owner.getProperty(target, prop);
        return target[prop];
        //return Reflect.get(target, prop, receiver);
    }
  }

  set(target, prop, value) {
    target[prop] = value;
    this.owner[this.ownerProp] = target;
    return true;
  }

  // getOwnPropertyDescriptor(target, prop) {
  //   if (prop === '@id') return { configurable: true, enumerable: true, writable: true }; //value: target[prop] 
  //   else return Reflect.getOwnPropertyDescriptor(target, prop);
  // }

  // ownKeys(target) {
  //   return ['@id'].concat(Object.getOwnPropertyNames(target));
  // }

  deleteProperty(target, prop) {
    console.log('delete');
    return false;
    //return !!this.owner.deleteProperty(target, prop);
  }
}

module.exports = { Node, Handler, ArrayHandler, Symbols };
