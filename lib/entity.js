const utils = require('./utils');

/**
 * @typedef {Object} EntityCollection
 * @property {function(string):Entity} getEntity - Get entity by id
 * @property {function(object, string, *)} setProperty - Set entity's property
 */

/**
 * Wrapper class for entity to provide linked objects capabilities.
 */
class Entity {
  #owner;
  /**
   * Create an entity wrapper
   * @param {EntityCollection} owner 
   * @param {Object} entity 
   * @returns 
   */
  constructor(owner, entity) {
    this.#owner = owner;
    return new Proxy(entity, this);
  }

  ownKeys(entity) {
    return Reflect.ownKeys(entity);
  }

  /**
   * 
   * @param {object} entity - Raw entity object, not the instance of Entity class.
   * @param {string} prop 
   * @returns {*|*[]}
   */
  get(entity, prop) {
    const owner = this.#owner;
    const resolveLinks = owner.config.resolveLinks;
    const alwaysAsArray = owner.config.alwaysAsArray;
    if (!(prop in {get:1, set:1, ownKeys:1}) && prop in this) {
      return (fn => ((...args) => fn.apply(entity, args)))(this[prop]);
    }
    if (prop === '$$target') return entity;
    if (prop === '@id') return entity[prop];
    if (prop === '@reverse') return new Entity(owner, entity[prop]);
    let vals = utils.asArray(entity[prop]).map(v => {
      if (v == null) return;
      if (resolveLinks && v["@id"]) {
        // catch a reference and return a nested object
        return owner.getEntity(v["@id"]) || v;
      } else {
        return v;
      }
    });
    if (vals.length > 0) {
      return (vals.length === 1 && !alwaysAsArray) ? vals[0] : vals;
    }
  }

  set(entity, prop, value) {
    this.#owner.setProperty(entity, prop, value);
    return true;
  }

  // Helper methods for entity.
  // These methods prefixed with $$ are to be called only by using Function.apply()
  // in which `this` is set to an entity data.
  /**
   * Return the underlying JSON-LD flat object representation.
   */
  $$toJSON() {
    return this;
  }
  /**
   * Check if an entity has the specified type.
   * @param {*} type 
   * @returns 
   */
  $$hasType(type) {
    return utils.asArray(this["@type"]).includes(type);
  }

  $$get(prop) {
    return this[prop];
  }

  /**
   * 
   * @param {string} prop 
   * @return {Array}
   * @memberof Entity
   * @instance 
   */
  $$getAsArray(prop) {
    return utils.asArray(this[prop]);
  }

}

module.exports = Entity;