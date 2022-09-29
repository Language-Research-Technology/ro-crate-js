/* This is part of rocrate-js a node library for implementing the RO-Crate data
packaging spec. Copyright (C) 2019 University of Technology Sydney

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
//@ts-check

require('cross-fetch/polyfill');
const defaults = require('./defaults');
const { Utils } = require('./utils');
const { Node, Handler, Symbols } = require('./node');

const { $target, $owner, $node, $proxy, $noderef } = Symbols;
const $size = Symbol('size');
const VALUE_TYPES = { string: 1, number: 1, boolean: 1 };

/**
 * @typedef {import('./types').RawEntity} RawEntity
 * @typedef {import('./types').Entity} Entity
 * @typedef {import('./node').NodeRef} NodeRef
 */

/**
 * Class for building, navigating, testing and rendering ROCrates
 * @todo import validation and rendering from Calcyte
 */
class ROCrate {
  static defaults = defaults;
  defaults = defaults;

  /**
   * Lookup table to get a reference to existing and non-existing nodes.
   * This is needed to avoid searching for the whole graph for every "@reverse" lookup 
   * and because an entity referenced by other entities may not exist yet in the graph.
   * @type {Map<string, Node>}
   */
  #nodeById = new Map();

  #handler;
  #handlerReverse;

  /** Lookup table to get list of entities by their type  */
  #entityByType = {};

  /** Internal representation of the context */
  #context = {};

  /** Index of all context contents or terms */
  #contextIndex;

  /** @deprecated Import {@link Utils} class directly*/
  utils = Utils;

  /**
   * Create a new ROCrate object using a default template or from a valid jsonld object.
   * @param {object} json a valid jsonld object
   * @param {object} config
   * @param {boolean} [config.array] - Always return property of an Entity as an array (eg when using getEntity() method)
   * @param {boolean} [config.link] - Resolve linked node as nested object
   * @param {boolean} [config.replace] - When importing from json, a subsequent duplicate entity always replaces the existing one
   * @param {boolean} [config.merge] - When replacing or updating an entity, merge the values and the properties instead of full replace
   * @param {boolean} [config.duplicate] - Allow duplicate values in a property that has multiple values
   */
  constructor(json = {}, config = {}) {
    this.config = {};
    this.config.array = config.array ?? config['alwaysAsArray'] ?? false;
    this.config.link = config.link ?? config['resolveLinks'] ?? false;
    this.config.replace = config.replace ?? config['replaceExisting'] ?? false;
    this.config.merge = config.merge ?? config['mergeProperties'] ?? false;
    this.config.duplicate = config.duplicate ?? config['allowDuplicates'] ?? false;

    this.#handler = new Handler(this);
    let that = this;
    this.#handlerReverse = {
      get(target, prop) {
        let vals = Utils.asArray(target[prop]).map(v => that.config.link ? that.getEntity(v["@id"]) : v);
        return (vals.length > 1 || that.config.array) ? vals : vals[0];
      }
    };

    //this.defaultMetadataIds = new Set(defaults.roCrateMetadataIDs);
    // init graph
    this.#context = Utils.clone(json["@context"] || defaults.context);
    this.#contextIndex = resolveLocalContext(this.#context);
    let g = json["@graph"];
    if (!Array.isArray(g) || !g.length) g = [
      defaults.datasetTemplate,
      defaults.metadataFileDescriptorTemplate
    ];
    for (let i = 0; i < g.length; ++i) {
      let e = g[i];
      e['@id'] = e['@id'] || `#${i}`;
      this.addEntity(e);
    }
    // validate graph
    if (this.rootId) {
      if (!this.rootDataset) throw new Error("There is no root dataset");
    } else {
      throw new Error("There is no pointer to the root dataset");
    }
  }

  /**
   * Create a new node or return an existing node with the given data
   * @param {string} id Identifier of the node (@id)
   * @returns {Node} a newly created or existing node that matches the id
   */
  #getNode(id) {
    let n = this.#nodeById.get(id);
    if (!n) {
      let ref = /** @type {*} */ ({ "@id": id || this.uniqueId('entity-') });
      Object.defineProperty(ref, '@reverse', { value: {} });
      n = new Node(ref);
      this.#nodeById.set(id, n);
    }
    return n;
  }


  /**
   * Return a proxy that wraps a node as an entity object supporting linked objects capability.
   * @param {Node} n 
   */
  #getNodeProxy(n) {
    if (!n[$proxy]) n[$proxy] = Proxy.revocable(n, this.#handler);
    return n[$proxy].proxy;
  }

  /**
   * 
   * @param {string|object} idOrEntity 
   * @return {Node}
   */
  #toNode(idOrEntity) {
    let id = '';
    let node;
    switch (typeof idOrEntity) {
      case 'string':
        id = idOrEntity;
        break;
      case 'object':
        node = idOrEntity?.[Symbols.$node]?.(this);
        //if (!node) id = idOrEntity['@id'];
        if (!node) {
          if (idOrEntity instanceof Node) node = idOrEntity;
          else id = idOrEntity['@id'];
        }
        break;
    }
    return node || this.#nodeById.get(id);
  }

  /**
   * Init a new node or update existing one
   * @param {Node} node
   * @param {object} data Update the node with the given data
   * @param {object} opt
   * @param {boolean} [opt.replace]
   * @param {boolean} [opt.merge]
   * @param {boolean} [opt.recurse]
   * @returns {boolean} Return true if node is changed
   */
  #updateNode(node, data, { replace = this.config.replace, merge = this.config.merge, recurse }) {
    if (node[$size] > 1) {
      if (!replace || node[$proxy]?.proxy === data) return false;
      if (!merge) {
        // remove existing data first
        for (const prop in node) this.deleteProperty(node, prop);
        node[$size] = 1;
      }
    } else {
      node[$size] = 1;
    }
    for (const prop in data) {
      if (prop !== '@id' && prop !== '@reverse') {
        this.#setProperty(node, prop, data[prop], { merge, replace, recurse });
        node[$size]++;
      }
    }
    //mapProp(data, (prop, v) => prop === '@id' ? null : this.#addValues(node[$noderef], prop, node[prop], v), node);
    // for (let t of utils.asArray(data["@type"])) {
    //     if (!this.#entityByType[t]) this.#entityByType[t] = [];
    //     this.#entityByType[t].push(data);
    // }
    return true;
  }

  #addValues(ref, prop, oldValues_, values, { duplicate = this.config.duplicate, replace = this.config.replace, merge = this.config.merge, recurse = false }) {
    let oldValues = Utils.asArrayRef(oldValues_);
    mapValue(values, v => {
      if (duplicate || !Utils.exists(oldValues, v)) {
        let nv = v;
        if (typeof v === 'object') {
          //let node = this.#toNode(v);
          //todo: check if object is already a node
          if (v['@id']) {
            let node = this.#getNode(v['@id']);
            if (recurse) this.#updateNode(node, v, { replace, merge, recurse });
            nv = node[$noderef];
            addReverse(ref, prop, nv);
          } else {
            // an array of array is not handled
            nv = Utils.clone(v);
          }
        }
        oldValues.push(nv);
      }
    });
    return oldValues.length === 1 ? oldValues[0] : oldValues;
  }

  get ['@context']() { return this.context; }

  /** 
   * The context part of the crate. An alias for '@context'.
   * Calling this method before and after resolveContext may give different result. 
   */
  get context() {
    return this.#contextIndex;
  }

  get ['@graph']() { return this.graph; }

  /**
   * An array of all nodes in the graph. An alias for '@graph' 
   * @return {Array}
   */
  get graph() {
    return this.getGraph();
  }

  get graphLength() {
    return this.graph.length;
  }

  get metadataFileEntity() {
    for (let id of defaults.roCrateMetadataIDs) {
      let e = this.getEntity(id);
      if (e != null && Utils.hasType(e, "CreativeWork")) {
        return e;
      }
    }
  }

  get rootDataset() {
    return this.getEntity(this.rootId);
  }

  get rootId() {
    let e = this.metadataFileEntity;
    if (e) return e.about["@id"] || e.about[0]["@id"];
  }

  set rootId(newId) {
    this.updateEntityId(this.rootId, newId);
  }

  /**
   * Deep clone the instance of this crate.
   */
  clone() {
    return new ROCrate(this, this.config);
  }

  /**
   * Add an entity to the crate.
   * @param {object} data A valid RO-Crate entity described in plain object.
   * @param {boolean} [replace] If true, replace existing entity with the same id.
   * @param {boolean} [recurse] - If true, nested entities will be added as well.
   * @return {boolean} true if the entity is successfully added.
   */
  addEntity(data, replace = this.config.replace, recurse) {
    let n = this.#getNode(data['@id']);
    return this.#updateNode(n, data, { replace, recurse });
  }

  /**
   * Delete an entity from the graph
   * @param {string|Entity} id_or_entity - Entity Identifier or the entity object itself
   * @param {boolean} [deleteRefs] - Set true to delete all references to the deleted entity
   * @return {RawEntity|undefined} If success, return the raw data of deleted entity
   */
  deleteEntity(id_or_entity, deleteRefs) {
    const n = this.#toNode(id_or_entity);
    if (n) {
      if (deleteRefs) {
        for (const p in n['@reverse']) {
          for (const ref in Utils.asArray(n['@reverse'][p])) {
            this.deleteValues(ref['@id'], p, n[$noderef]);
          }
        }
      }
      mapProp(n, (prop, v) => {
        if (v['@id']) removeReverse(n[$noderef], prop, v);
      });
      this.#nodeById.delete(n['@d']);
      n[$proxy]?.revoke();
      return n.toJSON();
    }
  }

  /**
   * Update an entity by replacing the object with the same id.
   * This operations will remove all properties of the existing entity and 
   * add the new ones contained in `data`, unless `merge` argument is true.
   * @param {Object} data 
   * @param {boolean} [merge] - If true, new properties will be merged. Defaults to `config.merge`.
   * @param {boolean} [recurse] - If true, nested entities will be updated as well.
   * @return {boolean} false if there is no existing entity with the same id or data is empty.
   */
  updateEntity(data, merge = this.config.merge, recurse) {
    let id = data['@id'];
    let n = this.#nodeById.get(id);
    //if (!n) throw new Error('Entity not found');
    if (n && n[$size]) return this.#updateNode(n, data, { replace: true, merge, recurse });
    return false;
  }

  /**
   * Change the identifier of an entity node
   * @param {*} idOrEntity 
   * @param {string} newId 
   */
  updateEntityId(idOrEntity, newId) {
    let n = this.#toNode(idOrEntity);
    if (n) {
      this.#nodeById.delete(n['@id']);
      this.#nodeById.set(newId, n);
      n['@id'] = newId;
      return true;
    }
    return false;
  }

  /**
   * Get the property of an entity
   * @param {*} idOrEntity 
   * @param {string} prop 
   * @returns {*} the value of the property
   */
  getProperty(idOrEntity, prop) {
    let entity = this.#toNode(idOrEntity);
    if (entity) {
      let val = entity[prop];
      if (prop === '@id') return val;
      if (prop === '@reverse') return new Proxy(val, this.#handlerReverse);
      if (typeof val === 'function') return val;
      if (val != null) {
        let vals = Utils.asArray(val).map(v => (this.config.link && v?.['@id']) ? this.getEntity(v["@id"]) || v : v);
        return (vals.length > 1 || this.config.array) ? vals : vals[0] || val;
      }
      return val;
    }
  }

  /**
   * 
   * @param {Node} entity 
   * @param {string} prop 
   * @param {*} values 
   * @param {object} opt
   * @param {boolean} [opt.duplicate]
   * @param {boolean} [opt.replace]
   * @param {boolean} [opt.recurse]
   * @param {boolean} [opt.merge]
   */
  #setProperty(entity, prop, values, { duplicate, replace, recurse, merge }) {
    //if (values == null) return this.deleteProperty(entity, prop);
    let ref = entity[Symbols.$noderef];
    // find entity ref that must be removed
    if (entity[prop]) {
      let newIds = new Set(mapValue(values, v => v['@id']));
      mapValue(entity[prop], v => !newIds.has(v['@id']) && removeReverse(ref, prop, v));
    }
    if (values == null) {
      entity[prop] = values;
    } else {
      entity[prop] = this.#addValues(ref, prop, [], values, { duplicate, replace, recurse, merge }) ?? [];
    }
    return true;
    //let oldVals = entity[prop];
    //return !utils.isEqual(oldVals, entity[prop]);
  }

  /**
   * Set a property of an entity with the given value.
   * If a property with the same name exists, its existing value will be replaced with the specified value.
   * If values contain nested non-empty entities, they will be processed recursively.
   * @param {string|object} idOrEntity - The id of the entity to add the property to
   * @param {string} prop - The name of the property
   * @param {*|Array} values - A value or an array of values
   * @param {boolean} [duplicate] - If true, allow a property to have duplicate values
   */
  setProperty(idOrEntity, prop, values, duplicate) {
    let entity = this.#toNode(idOrEntity);
    if (!entity) throw new Error('Cannot set property of a non-existant entity');
    if (prop === '@reverse') throw new Error('@reverse property is read only');
    if (prop === '@id') {
      if (typeof values === 'string') return this.updateEntityId(entity, values);
      else return false;
    }
    return this.#setProperty(entity, prop, values, { duplicate, recurse: true });
  }

  deleteProperty(idOrEntity, prop) {
    if (prop === '@id' || prop === '@reverse') throw new Error(`Property ${prop} is not allowed be deleted`);
    let entity = this.#toNode(idOrEntity);
    if (entity && prop in entity) {
      removeAllReverse(entity, [prop]);
      let r = entity[prop];
      delete entity[prop];
      return r;
    }
  }

  /**
   * Delete one or more values from a property.
   * @param {string|Entity} idOrEntity 
   * @param {string} prop 
   * @param {*} values 
   */
  deleteValues(idOrEntity, prop, values) {
    if (prop === '@id' || prop === '@reverse') throw new Error(`Property ${prop} is not allowed be deleted`);
    let entity = this.#toNode(idOrEntity);
    if (entity && prop in entity) {
      let ids = new Set(mapValue(values, v => v['@id']));
      removeAllReverse(entity, [prop], id => ids.has(id));
      let vals = Utils.asArray(values);
      let r = Utils.asArray(entity[prop]).filter(v => !vals.some(val => Utils.isEqualRef(v, val)));
      if (r.length) entity[prop] = r;
      else delete entity[prop];
    }
  }

  /**
   * Add one or more value to a property of an entity.
   * If the specified property does not exists, a new one will be set. 
   * If the property already exists, the new value will be added to the property array.
   * @param {string|object} idOrEntity - The id or the entity to add the property to
   * @param {string} prop - The name of the property
   * @param {*} values - The value of the property
   * @param {boolean} [duplicate] - If true, allow a property to have duplicate values in the array
   */
  addValues(idOrEntity, prop, values, duplicate) {
    let entity = this.#toNode(idOrEntity);
    if (!entity) throw new Error('Cannot add values to a non-existant entity');
    if (values == null || prop === '@id' || prop === '@reverse') return false;
    let ref = entity[Symbols.$noderef];
    let oldCount = Utils.asArrayRef(entity[prop]).length;
    entity[prop] = this.#addValues(ref, prop, entity[prop], values, { duplicate, recurse: true });
    return Utils.asArrayRef(entity[prop]).length > oldCount;
  }

  /**
   * Get configuration value
   * @param {'array'|'link'|'replace'|'merge'|'duplicate'} key - Name of the config parameter
   */
  getConfig(key) {
    return this.config[key];
  }

  /**
   * Get an entity from the graph. 
   * If config.link is true, any reference (object with just "@id" property)
   * is resolved as a nested object. 
   * @param {string} id An entity identifier
   * @return {Entity|undefined} A wrapper for entity that resolves properties as linked objects
   */
  getEntity(id) {
    let n = this.#nodeById.get(id);
    if (n && n[$size]) return this.#getNodeProxy(n);
  }

  /**
   * Get the index of the entity in the graph array. This is an O(n) operation.
   * @param {string} entityId 
   */
  indexOf(entityId) {
    let count = 0;
    for (const [id, n] of this.#nodeById) {
      if (n[$size]) {
        if (id === entityId) return count;
        ++count;
      }
    }
    return -1;
    //return this.#nodeById.get(id)?.index ?? -1;
  }

  /**
   * Get an array of all nodes in the graph. Each node in the array is an Entity instance.
   * If config.link is true, any link to other node will be made into nested object.
   * @param {boolean} raw - If true, return the internal representation as plain object.
   * @return {Array}
   */
  getGraph(raw = false) {
    var g = [];
    for (const n of this.#nodeById.values()) {
      if (n[$size]) {
        let e = raw ? n.toJSON() : this.#getNodeProxy(n);
        g.push(e);
      }
    }
    return g;
  }

  /**
   * Add a Profile URI to the crate
   * @param {string} uri A valid Profile URI
   */
  addProfile(uri) {
    this.addValues(this.metadataFileEntity, "conformsTo", { "@id": uri });
    this.addValues(this.rootDataset, "conformsTo", { "@id": uri });
  }

  addProvenance(prov) {
    this.addEntity(prov.corpusTool);
    this.addEntity(prov.createAction);
  }

  /**
   * Add a new identifier as a PropertyValue to the root DataSet.
   * identifier and name are required
   * @param {object} options 
   * @param {string} options.name
   * @param {string} options.identifier 
   * @param {string} [options.description]
   * @return The added identifier or undefined
   */
  addIdentifier(options) {
    if (options.identifier && options.name && this.rootId) {
      const entityId = `_:local-id:${options.name}:${options.identifier}`;
      const entity = {
        '@id': entityId,
        '@type': 'PropertyValue',
        value: options.identifier,
        name: options.name
      };
      if (options.description) entity.description = options.description;
      if (this.addValues(this.rootId, 'identifier', entity, false)) {
        return entityId;
      }
    }
  }

  /**
   * Get named identifier
   * @param {string} name 
   * @return {string} the identifier
   */
  getIdentifier(name) {
    const root = this.#toNode(this.rootId);
    /** @type { Array.<{'@id':string, '@type':string, value:string, name:string}> } */
    const identifier = mapValue(root['identifier'], v => {
      const idEntity = this.getEntity(v["@id"]);
      if (idEntity && this.hasType(idEntity, "PropertyValue") && idEntity.name === name) return idEntity;
    });
    if (identifier.length) return identifier[0].value;
  }

  /**
   * Convert the rocrate into plain JSON object.
   * The value returned by this method is used when JSON.stringify() is used on the ROCrate object.
   * @return plain JSON object
   */
  toJSON() {
    return { '@context': this.#context, '@graph': this.getGraph(true) };
  }

  /**
   * Return a JSON.stringify-ready tree structure starting from the specified item 
   * with all values (apart from @id) as arrays
   * and string-values expressed like: `{"@value": "string-value"}`
   * @param {object} opt 
   * @param {string|object} [opt.root]
   * @param {number} [opt.depth] The number of nesting the tree will have. Must be 0 or positive integer.
   * @param {boolean} [opt.valueObject]
   * @param {boolean} [opt.allowCycle] 
   * @returns {*} the root entity
   */
  getTree({ root = this.rootId, depth = Infinity, valueObject = true, allowCycle = false } = {}) {
    if (depth == Infinity && allowCycle) throw new Error('Option allowCycle must be set to false is depth is not finite');
    let rootEntity = this.#toNode(root)?.toJSON();
    if (!rootEntity || depth < 0) return;
    // do a BFS algorithm with queue, instead of DFS with recursion
    /** @type {[[RawEntity, number, Set<string>]]} */
    let queue = [[rootEntity, 0, new Set()]];
    let current;
    while (current = queue.shift()) {
      let [node, level, parents] = current;
      if (!allowCycle) {
        parents = new Set(parents);
        parents.add(node['@id']);
      }
      for (let prop in node) {
        let val = node[prop];
        if (prop === "@type") {
          node[prop] = Utils.asArray(val);
        } else if (prop === "@reverse") {
          delete node[prop];
        } else if (prop !== "@id") {
          node[prop] = Utils.asArray(val).map(v => {
            let id;
            if (v != null && (id = v['@id'])) {
              if (level < depth && !parents.has(id)) { //!this.hasType(prop, v, '@json')
                let e = this.#toNode(id);
                if (e) v = e.toJSON();
                queue.push([v, level + 1, parents]);
              }
            } else if (valueObject) {
              v = { "@value": v };
            }
            return v;
          });
        }
      }
    }
    return rootEntity;
  }


  /**
   * 
   * @param {*} items - A JSON-LD item or array of [item]
   * @param {*[]} pathArray - An array of objects that represents a 'path' through the graph.
   *   Object must have a "property" to follow, eg:
   *   `resolve(item, {"property": "miltaryService"});`
   *   and optionally a condition "includes", eg:
   *   `"includes": {"@type", "Action"}}`
   *   and optionally, a function "matchFn" which takes an item 
   *   as argument and returns a boolean, eg:
   *   `"matchFn": (item) => item['@id'].match(/anzsrc-for/)`
   * @param {*[]} [subgraph] - If present and true, all intervening items during
   *   the traversal will be stored. If an array is passed, the intervening items will be
   *   stored in the array.
   * @return {*[]|null} null, or an array of items
   */
  resolve(items, pathArray, subgraph) {
    const p = pathArray.shift();
    const resolvedArray = [];
    const resolvedIds = {};
    items = Utils.asArray(items);
    for (let item of items) {
      item = this.getEntity(item['@id']);
      if (p["@reverse"] && item["@reverse"]) {
        item = item["@reverse"];
      }

      if (item[p.property]) {
        for (let val of Utils.asArray(item[p.property])) {
          if (val["@id"] && this.getItem(val["@id"])) {
            const id = val["@id"];
            if (!resolvedIds[id]) {
              const potentialItem = this.getItem(val["@id"]);
              if (p.includes) {
                for (let inc of Object.keys(p.includes)) {
                  if (Utils.asArray(potentialItem[inc]).includes(p.includes[inc])) {
                    resolvedArray.push(potentialItem);
                    resolvedIds[id] = 1;
                  }
                }
              } else if (p.matchFn) {
                if (p.matchFn(potentialItem)) {
                  resolvedArray.push(potentialItem);
                  resolvedIds[id] = 1;
                }
              } else {
                resolvedArray.push(potentialItem);
                resolvedIds[id] = 1;
              }
            }
          }
        }
      }
    }
    if (resolvedArray.length === 0) return null;
    if (subgraph) {
      for (const item of resolvedArray) {
        if (!subgraph.find(e => e['@id'] === item['@id'])) subgraph.push(item);
      }
    }
    if (pathArray.length > 0) {
      return this.resolve(resolvedArray, pathArray, subgraph);
    } else {
      return resolvedArray; // Found our final list of results
    }
  }

  /**
   * resolveAll does a resolve but collects and deduplicates intermediate items.
   * Its first returned value is the final items (ie what resolve(..)) would have returned.
   * @param {*} items 
   * @param {*} pathArray 
   * @returns 
   */
  resolveAll(items, pathArray) {
    let subgraph = [];
    const finals = this.resolve(items, pathArray, subgraph);
    return [finals, subgraph];
  }


  /**
   * Generate a new unique id that does not match any existing id in the graph.  
   * @param {string} base - The base string of the id.
   * @return {string} The base suffixed with the incremental number. 
   */
  uniqueId(base) {
    var i = 1;
    var uid = base;
    while (this.#nodeById.has(uid)) {
      uid = base + (i++);
    }
    return uid;
  }


  /** Experimental method to turn a graph into a flat dictionary eg for turning it into a table  */
  flatify(item, depth, flatItem, propPath, seen) {
    // Assume item has been graphified
    if (!depth) {
      depth = 0;
    }
    if (!flatItem) {
      flatItem = {};
    }
    if (!propPath) {
      propPath = "";
    }
    if (!seen) {
      seen = {};
    }
    if (!seen[item["@id"]]) {
      seen[item["@id"]] = true;
      for (let prop of Object.keys(item)) {
        const newPropPath = `${propPath}${prop}`;

        if (prop === "@id") {
          flatItem[newPropPath] = item["@id"];
        } else if (prop === "@type") {
          flatItem[newPropPath] = item["@type"];
        }
        else if (prop != "@reverse") {
          var valCount = 0;
          for (let val of item[prop]) {
            const valPropPath = `${newPropPath}_${valCount++}`;
            if (val["@id"]) {
              // It's a nested object
              // TODO - recurse
              if (depth > 0 && !seen[val["@id"]]) {
                this.flatify(val, depth - 1, flatItem, valPropPath + "_", seen);
              } else {
                if (val["name"]) {
                  flatItem[valPropPath] = val["name"][0];
                } else {
                  flatItem[valPropPath] = val["@id"];
                }

              }
            } else {
              flatItem[valPropPath] = val;
            }
          }
        }
      }
    }
    return flatItem;

  }

  /**
   * Generate a local flat lookup table for context terms
   */
  async resolveContext() {
    let t = this;
    this.#contextIndex = {};
    let results = Utils.asArray(this.#context).map(async (contextUrl) => {
      if (typeof contextUrl === 'string') {
        if (defaults.standardContexts[contextUrl]) {
          return defaults.standardContexts[contextUrl]["@context"];
        }
        const response = await fetch(contextUrl, {
          headers: {
            'accept': "application/ld+json, application/ld+json, text/text"
          }
        });
        if (!response.ok) throw new Error(response.statusText);
        return (await response.json())["@context"];
      } else {
        return contextUrl;
      }
    });
    results = await Promise.all(results);

    this.#contextIndex = results.reduce(indexContext, this.#contextIndex);
    return {
      _indexer: this.#contextIndex,
      getDefinition(term) {
        return t.#getDefinition(this._indexer, term);
      }
    };
  }

  #getDefinition(context, term) {
    /*
    {
    "@id": "http://expertnation2020.uts.edu.au/vocab/#Class/1125-30",
    "@type": "rdfs:Class",
    "name": "Scholarship awards",
    "rdfs:comment": "Schoalrships and other educational awards",
    "rdfs:label": "ScholarshipAwards"
    },
    {
    "@id": "http://expertnation2020.uts.edu.au/vocab/#Property/1125-91",
    "@type": "rdf:Property",
    "name": "Scholarships/awards",
    "rdfs:comment": "Scholarships and other awards received",
    "rdfs:label": "scholarships_awards"
    },
    */
    var def = {};
    const val = context[term];
    if (val && val.match(/^http(s?):\/\//i)) {
      def["@id"] = val;
    } else if (val && val.match(/(.*?):(.*)/)) {
      const parts = val.match(/(.*?):(.*)/);
      const urlPart = context[parts[1]];
      if (urlPart && urlPart.match(/^http(s?):\/\//i)) {
        def["@id"] = `${urlPart}${parts[2]}`;
      }
    }
    let localDef;
    if (def["@id"] && (localDef = this.getEntity(def["@id"])) != null) {
      if (localDef.sameAs && localDef.sameAs["@id"]) {
        // There's a same-as - so use its ID
        def["@id"] = localDef.sameAs["@id"];
        localDef = this.getEntity(def["@id"]);
      }
      if (localDef && (this.hasType(localDef, "rdfs:Class") || this.hasType(localDef, "rdf:Property"))) {
        def = localDef;
      }
    }

    return def;

  }

  /**
   * Get the context term definition. Make sure `resolveContext()` has been called prior calling this method.
   * @param {string} term 
   */
  getDefinition(term) {
    return this.#getDefinition(this.#contextIndex, term);
  }

  /**
   * Add context
   * @param {*} context 
   */
  addContext(context) {
    this.#context = Utils.asArray(this.#context);
    this.#context.push(context);
    indexContext(this.#contextIndex, context);
  }

  resolveTerm(term) {
    if (!this.#contextIndex) return;
    if (term.match(/^http(s?):\/\//i)) {
      return term;
    }
    term = term.replace(/^schema:/, ""); //schema is the default namespace
    const val = this.#contextIndex[term];
    if (val && val.match(/^http(s?):\/\//i)) {
      return val;
    } else if (val && val.match(/(.*?):(.*)/)) {
      const parts = val.match(/(.*?):(.*)/);
      const urlPart = this.#contextIndex[parts[1]];
      if (urlPart && urlPart.match(/^http(s?):\/\//i)) {
        return `${urlPart}${parts[2]}`;
      }
    } else if (term.match(/(.*?):(.*)/)) {
      // eg txc:Somthing
      const parts = term.match(/(.*?):(.*)/);
      const url = this.#contextIndex[parts[1]];
      if (url && url.match(/^http(s?):\/\//i)) {
        return `${url}${parts[2]}`;
      }
    }
    return null;
  }

  /**
   * Check if an entity has a type
   * @param {*} item 
   * @param {string} type 
   * @return {boolean}
   */
  hasType(item, type) {
    return Utils.hasType(item, type);
  }

  /**
   * This silently fails if the item has no @id or already exists - this is probably sub-optimal
   * @param {*} item 
   * @deprecated Use {@link addEntity}
   */
  addItem(item) {
    return this.addEntity(item);
  }

  /**
   * @deprecated Use {@link deleteEntity}
   * @param {string} id 
   * @return {Object} The raw data of deleted entity
   */
  deleteItem(id) {
    return this.deleteEntity(id);
  }

  /** @deprecated Not required anymore. Calling this method will do nothing. */
  addBackLinks() { }

  /** @deprecated Use {@link Utils.union}, eg: union([sg1, sg2]) */
  dedupeSubgraphs(subgraphs) {
    return Utils.union(...subgraphs);
  }

  /** @deprecated Not required anymore. Calling this method will do nothing. */
  index() { }

  /**
   * Add a value to an item's property array
   * @param {*} item 
   * @param {string} prop 
   * @param {*} val 
   * @param {boolean} allowDuplicates 
   * @deprecated Use {@link addValues} 
   */
  pushValue(item, prop, val, allowDuplicates = false) {
    this.addValues(item['@id'], prop, val, allowDuplicates);
  }

  /** @deprecated Use {@link updateEntityId} */
  changeGraphId(item, newId) {
    return this.updateEntityId(item['@id'], newId);
  }

  /**
   * @param {string} id 
   * @returns {Entity} entity
   * @deprecated Use {@link getEntity}
   */
  getItem(id) {
    return this.getEntity(id);
  }

  /** @deprecated Use {@link getGraph} with argument set to true */
  getFlatGraph() {
    return this.getGraph(true);
  }

  /** @deprecated Use {@link rootDataset} */
  getRootDataset() {
    return this.rootDataset;
  }

  /** @deprecated Use {@link rootId} */
  getRootId() {
    return this.rootId;
  }

  /** @deprecated Use {@link toJSON} */
  getJson() { return this.toJSON(); }

  /** @deprecated Use {@link getIdentifier} */
  getNamedIdentifier(name) {
    return this.getIdentifier(name);
  }

  /** @deprecated Use {@link getGraph} and pass true as the argument */
  serializeGraph() {
    return this.getGraph(true);
  }

  /** @deprecated Specify `{array: true, link: true}` in the options when creating the ROCrate instance */
  toGraph() {
    this.config.array = true;
    this.config.link = true;
    return true;
  }

  /** @deprecated Use {@link getTree} with the following argument: `{ root, depth, allowCycle: true }` */
  getNormalizedTree(root, depth = 1) {
    return this.getTree({ root, depth, allowCycle: true });
  }

  /**
   * Create a simple tree-like object - but don't make circular structures
   * @deprecated Use {@link getTree} with the valueObject argument set to false` 
   */
  objectify() {
    return this.getTree({ valueObject: false });
  }

}

/**
 * Iterate over values of a property of an entity and return filtered and mapped results.
 * @param {*} val - A value or an array of values that will be iterated over
 * @param {function} fn - Call this function for each reference in each value. Null result will be omitted.
 */
function mapValue(val, fn) {
  let results = [];
  for (let v of Utils.asArray(val)) {
    if (v != null) {
      let result = fn(v);
      if (result != null) results.push(result);
    }
  }
  return results;
}

function mapProp(entity, fn, results = {}) {
  let count = results[$size] || 0;
  for (let prop in entity) {
    let r = mapValue(entity[prop], v => fn(prop, v));
    r = r.length > 1 ? r : r[0];
    if (r) {
      results[prop] = r;
      count++;
      results[$size] = count;
    }
  }
  return results;
}

function indexContext(indexer, c) {
  // Put all the keys into a flat lookup TODO: handle indirection
  for (let name in c) {
    const v = c[name];
    if (v) indexer[name] = v["@id"] || v;
  }
  return indexer;
}

function addReverse(parentRef, prop, childRef) {
  let rev = childRef['@reverse'] || {};
  let revprop = rev[prop] = rev[prop] || [];
  if (!revprop.includes(parentRef)) revprop.push(parentRef);
}

function removeReverse(parentRef, prop, childRef) {
  let rev = childRef['@reverse'];
  if (rev) {
    let i = rev[prop].indexOf(parentRef);
    if (i > -1) rev[prop].splice(i, 1);
  }
}

/**
 * Remove all reverse links that point to the targetNode
 * @param {Node} targetNode The node in which any reverse entry of it will be removed
 * @param {string[]} [props]
 * @param {(id:string)=>boolean} [filterFn]
 */
function removeAllReverse(targetNode, props, filterFn) {
  var targetRef = targetNode[$noderef];
  var keys = props ?? Object.keys(targetNode);
  for (const key of keys) {
    for (const v of Utils.asArray(targetNode[key])) {
      const rev = v?.['@reverse'];
      if (rev && (!filterFn || filterFn(v['@id']))) {
        let i = rev[key].indexOf(targetRef);
        if (i > -1) rev[key].splice(i, 1);
      }
    }
  }
}

function resolveLocalContext(context) {
  var indexer;
  for (let c of Utils.asArray(context)) {
    if (typeof c === "string") {
      c = defaults.standardContexts[c]?.["@context"];
    }
    if (typeof c === "object") {
      if (!indexer) indexer = {};
      indexContext(indexer, c);
    }
  }
  return indexer;
}


// function resetNode(node) {
//   node[$size] = 1;
//   node[$proxy]?.revoke();
//   node[$proxy] = undefined;
// }


module.exports = { ROCrate };
