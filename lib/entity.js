//@ts-check
const utils = require('./utils');
const $raw = Symbol('entity');
const $owner = Symbol('owner');

class Handler {
  constructor(entity) {
    this.entity = entity;
  }

  // ownKeys(target) {
  //   return Reflect.ownKeys(target);
  // }

  get(target, prop) {
    const entity = this.entity;
    const owner = entity[$owner];
    const { resolveLinks, alwaysAsArray } = owner.config;
    if (prop in entity) return entity[prop];
    //return (fn => ((...args) => fn.apply(entity, args)))(this[prop]);
    //if (prop === '$$target') return entity;
    else if (prop === '@id') return target[prop];
    else if (prop === '@reverse') return new Entity(owner, target[prop]);
    else if (prop in target) {
      let vals = utils.asArray(target[prop]).map(v => (v?.["@id"] && resolveLinks) ? owner.getEntity(v["@id"]) || v : v);
      // if (v == null) return;
      // if (resolveLinks && v["@id"]) {
      //   // catch a reference and return a nested object
      //   return owner.getEntity(v["@id"]) || v;
      // } else {
      //   return v;
      // }
      //if (vals.length > 0) { return (vals.length === 1 && !alwaysAsArray) ? vals[0] : vals; }
      return (vals.length > 1 || alwaysAsArray) ? vals : vals[0];
    }
  }

  set(target, prop, value) {
    if (prop in this.entity) return false;
    const owner = this.entity[$owner];
    owner.setProperty(target, prop, value);
    return true;
  }

}

/**
 * Wrapper class for entity to provide linked objects capabilities.
 * @template T
 */
class _Entity {
  static $raw = $raw;
  static $owner = $owner;
  /**
   * Create an entity wrapper.
   * @param {EntityCollection} owner - The object that owns the entity, eg ROCrate
   * @param {T} raw - entity plain object to be wrapped 
   */
  constructor(owner, raw) {
    this[$owner] = owner;
    this[$raw] = raw;
    return new Proxy(raw, new Handler(this));
  }

  get $$owner() {
    return this[$owner];
  }

  get $$raw() {
    return this[$raw];
  }

  /**
   * Return the underlying JSON-LD flat object representation.
   */
  toJSON() {
    return this.$$raw;
  }
  /**
   * Check if an entity has the specified type.
   * @param {*} type 
   * @returns {boolean}
   */
  $$hasType(type) {
    return utils.asArray(this.$$raw["@type"]).includes(type);
  }

  $$get(prop) {
    return this.$$raw[prop];
  }

  /**
   * 
   * @param {string} prop 
   * @return {Array}
   * @memberof Entity
   * @instance 
   */
  $$getAsArray(prop) {
    return utils.asArray(this.$$raw[prop]);
  }

}

/**
 * @typedef {Object} EntityCollection
 * @property {function(string):*} getEntity - Get entity by id
 * @property {function(object, string, *):*} setProperty - Set entity's property
 * @property {*} config - Config
 */
/**
 * @template T
 * @typedef { _Entity<T> & T } Entity<T>
 */
/**
 * @type new <T>(owner: EntityCollection, entity: T) => Entity<T>
 */
const Entity = /**@type {*}*/(_Entity);

module.exports = Entity;
