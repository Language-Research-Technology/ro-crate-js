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

const _g = typeof window === 'object' ? window : (typeof global === 'object' ? global : {});
const fetch = _g.fetch || require('cross-fetch');
const defaults = require('./defaults');
const { Utils } = require('./utils');
const { Node, Handler, ArrayHandler, Symbols } = require('./node');

const { $target, $owner, $node, $proxy, $noderef } = Symbols;
const $size = Symbol('size');
const VALUE_TYPES = { string: 1, number: 1, boolean: 1 };

/**
 * @typedef {import('./types').RawEntity} RawEntity
 * @typedef {import('./types').Entity} Entity
 * @typedef {import('./types').NodeRef} NodeRef
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
   * as an entity referenced by other entities may not exist yet in the graph.
   * @type {Map<string, Node>}
   */
  __nodeById = new Map();

  /** Lookup table to index nodes by their properties */
  //#nodeByX = {};

  __handler;
  __handlerReverse;

  /** Internal representation of the context */
  __context;

  /** Index of all context contents or terms */
  __contextTermIndex = new Map();
  __contextDefinitionIndex = new Map();

  /** @deprecated Import {@link Utils} class directly*/
  utils = Utils;

  /**
   * Create a new ROCrate object using a default template or from a valid jsonld object.
   * @param {object} json a valid jsonld object
   * @param {object} [config]
   * @param {boolean} [config.array] - Always return property of an Entity as an array (eg when using getEntity() method)
   * @param {boolean} [config.link] - Resolve linked node as nested object
   * @param {boolean} [config.replace] - When importing from json, a subsequent duplicate entity always replaces the existing one
   * @param {boolean} [config.merge] - When replacing or updating an entity, merge the values and the properties instead of full replace
   * @param {boolean} [config.duplicate] - Allow duplicate values in a property that has multiple values
   * @param {string} [config.defaultType] - The default value for `@type` to be used when adding a new entity and the property is not specified. Default to 'Thing' 
   */
  constructor(json = {}, config) {
    if (!(json["@context"] || json["@graph"]) && !config) config = json;
    this.config = {};
    this.config.array = config?.array ?? config?.['alwaysAsArray'] ?? false;
    this.config.link = config?.link ?? config?.['resolveLinks'] ?? false;
    this.config.replace = config?.replace ?? config?.['replaceExisting'] ?? false;
    this.config.merge = config?.merge ?? config?.['mergeProperties'] ?? false;
    this.config.duplicate = config?.duplicate ?? config?.['allowDuplicates'] ?? false;
    this.config.defaultType = config?.defaultType ?? 'Thing';

    this.__handler = new Handler(this);
    let that = this;
    this.__handlerReverse = {
      get(target, prop) {
        let vals = Utils.asArray(target[prop]).map(v => that.config.link ? that.getEntity(v["@id"]) : v);
        return (vals.length > 1 || that.config.array) ? vals : vals[0];
      }
    };

    //this.defaultMetadataIds = new Set(defaults.roCrateMetadataIDs);
    // init graph
    this.__context = Utils.asArray(Utils.clone(json["@context"] || defaults.context));

    resolveLocalContext(this.__context, this.__contextTermIndex, this.__contextDefinitionIndex);
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
   * @param {NodeRef} [ref] An immutable and unique reference to node that contains id and reverse information only 
   * @returns {Node} a newly created or existing node that matches the id
   */
  __getNode(id, ref) {
    let n = this.__nodeById.get(id);
    if (!n) {
      if (!ref) {
        // @ts-ignore
        ref = { "@id": id || this.uniqueId('entity-') };
        Object.defineProperty(ref, '@reverse', { value: {} });
      }
      n = new Node(ref);
      this.__nodeById.set(n['@id'], n);
    }
    return n;
  }


  /**
   * Return a proxy that wraps a node as an entity object supporting linked objects capability.
   * @param {Node} n 
   */
  __getNodeProxy(n) {
    if (!n[$proxy]) n[$proxy] = Proxy.revocable(n, this.__handler);
    return n[$proxy].proxy;
  }

  /**
   * 
   * @param {string|object} idOrEntity 
   * @return {Node}
   */
  __toNode(idOrEntity) {
    if (idOrEntity instanceof Node) {
      let node = idOrEntity[$node]?.(this);
      if (node) return node;
      else if (node === undefined) return idOrEntity;
    }
    let id = '';
    if (typeof idOrEntity === "string") {
      id = idOrEntity;
    } else if (typeof idOrEntity['@id'] === "string") {
      id = idOrEntity['@id'];
    }
    let node = this.__nodeById.get(id);
    if (node?.[$size]) return node;
  }

  /**
   * Init a new node or update existing one
   * @param {Node} node
   * @param {object} data Update the node with the given data
   * @param {object} opt
   * @param {boolean} [opt.replace] If false and if node already exists, do nothing to the node 
   * @param {boolean} [opt.merge] If false and if node already exists, remove all existing properties not in the specified data
   * @param {boolean} [opt.recurse] Process nested objects recursively
   * @param {boolean} [opt.add] If true, create an entity even if the data is empty
   * @param {WeakSet} [opt.seen] A set to keep track of cyclic reference in the input
   * @returns {boolean} Return true if node is changed
   */
  __updateNode(node, data, { replace = this.config.replace, merge = this.config.merge, recurse, add, seen }) {
    var keys = Object.keys(data).filter(prop => prop !== '@id' && prop !== '@reverse');
    if (!add && !keys.length) return false;
    if (recurse) {
      if (!seen) seen = new WeakSet();
      if (seen.has(data)) return false;
      seen.add(data);
    }
    //console.log('node[$size]', node[$size]);
    if (node[$size]) {
      //console.log('replace', replace);
      if (!replace || node[$proxy]?.proxy === data) return false;
      if (!merge) {
        // remove existing data first
        for (const prop in node) {
          if (prop !== '@type' && !keys.includes(prop)) {
            this.deleteProperty(node, prop);
          }
        }
        //node[$size] = 1;
      }
    } else {
      node[$size] = 1;
    }
    for (const prop of keys) {
      this.__setProperty(node, prop, data[prop], { merge, replace, recurse, seen });
    }
    if (!node['@type']) {
      this.__setProperty(node, '@type', 'Thing', {});
    }

    //mapProp(data, (prop, v) => prop === '@id' ? null : this.__addValues(node[$noderef], prop, node[prop], v), node);
    // for (let t of utils.asArray(data["@type"])) {
    //     if (!this.#entityByType[t]) this.#entityByType[t] = [];
    //     this.#entityByType[t].push(data);
    // }
    return true;
  }

  __addValues(ref, prop, oldValues_, values, { duplicate = this.config.duplicate, replace = this.config.replace, merge = this.config.merge, recurse = false, seen = null }) {
    let oldValues = Utils.asArrayRef(oldValues_);
    const exists = (() => {
      if (duplicate) {
        return (() => false);
      } else {
        const oldVals = new Set(oldValues.map(v => typeof v === 'object' ? Symbol.for(v['@id']) : v));
        return function (v) {
          let key = v;
          if (typeof v === 'object' && v['@id']) key = Symbol.for(v['@id']);
          return oldVals.has(key);
        };
      }
    })();
    mapValue(values, v => {
      if (duplicate || !Utils.exists(oldValues, v)) {
        let nv = v;
        if (typeof v === 'object') {
          // an array of array is not handled
          if (Array.isArray(v)) throw new Error('An array of array is not supported');
          let node = v[$node]?.(this); //check if v is a node proxy
          if (!node) {
            //let id = v['@id'] || this.uniqueId('#_blank-');
            node = this.__getNode(v['@id']);
            if (recurse) this.__updateNode(node, v, { replace, merge, recurse, seen });
          }
          nv = node[$noderef];
          addReverse(ref, prop, nv);
        }
        oldValues.push(nv);
      }
    });
    return oldValues.length === 1 ? oldValues[0] : oldValues;
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
   * @param {WeakSet} [opt.seen]
   */
  // TODO: return false if no change in value
  __setProperty(entity, prop, values, { duplicate, replace, recurse, merge, seen }) {
    //if (values == null) return this.deleteProperty(entity, prop);
    let ref = entity[Symbols.$noderef];
    if (!(prop in entity)) entity[$size]++;
    if (values != null) {
      // find entity ref that must be removed
      if (entity[prop]) {
        let newIds = new Set(mapValue(values, v => v['@id']));
        mapValue(entity[prop], v => !newIds.has(v['@id']) && removeReverse(ref, prop, v));
      }
      entity[prop] = this.__addValues(ref, prop, [], values, { duplicate, replace, recurse, merge, seen }) ?? [];
    } else if (prop in entity) {
      this.deleteProperty(entity, prop);
    }
    return true;
    //let oldVals = entity[prop];
    //return !utils.isEqual(oldVals, entity[prop]);
  }


  get ['@context']() { return this.context; }

  /** 
   * The context part of the crate. An alias for '@context'.
   * This returns the original context information. 
   */
  get context() {
    const arr = Array.from(this.__context);
    if (arr.length <= 1 && !this.config.array) return arr[0];
    return arr;
  }

  get ['@graph']() { return this.graph; }

  /**
   * An array of all nodes in the graph. An alias for '@graph' 
   * @return {Array}
   */
  get graph() {
    return this.getGraph();
  }

  get graphSize() {
    return this.graph.length;
  }

  /** @return {Entity} */
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

  /**
   * The root identifier of the RO Crate
   * @return {string}
   */
  get rootId() {
    let e = this.metadataFileEntity;
    if (e) return e.about["@id"] || e.about[0]["@id"];
  }

  set rootId(newId) {
    this.updateEntityId(this.rootId, newId);
  }


  //////// Public mutator methods
  /**
   * Append the specified string or object directly as an entry into the RO-Crate JSON-LD Context array.
   * It does not check for duplicates or overlapping content if the context is an object.
   * @param {string|object|string[]|object[]} context - A URL or an Object that contains the context mapping
   */
  addContext(context) {
    for (let c of Utils.asArrayRef(context)) {
      if (!this.__context.includes(c)) {
        this.__context.push(c);
        indexContext(context, this.__contextTermIndex, this.__contextDefinitionIndex);
      }
    }
  }

  /**
   * Add the term and its definition to the first context definition (a map) found from the `@context` entries.
   * If no existing context definition found, a new one will be created.
   * @param {string} term  The term name like 'name' or 'schema:name'
   * @param {string|object} definition  The term IRI
   * @param {boolean} [force]  If the term is in the format of prefix:suffix and force is true, add the term to the context as it is
   */
  addTermDefinition(term, definition, force) {
    let id = this.resolveTerm(term);
    if (id) return;

    id = this.resolveTerm(typeof definition === 'string' ? definition : definition?.["@id"]); //id is always string
    let context = this.__context.find(c => typeof c === 'object');
    if (!context) {
      context = {};
      this.__context.push(context);
    }
    let name = term;
    let def = definition;
    const [prefix, suffix] = term.split(':'); // name can be a prefix if a format of prefix:suffix is used
    if (suffix && !force) {
      name = prefix;
      if (id.endsWith(suffix)) {
        def = id.slice(0, -suffix.length);
      }
    }
    context[name] = def;
    this.__contextTermIndex.set(name, def);
    this.__contextDefinitionIndex.set(id, name);
  }

  /**
   * Add an entity to the crate.
   * @param {object} data A valid RO-Crate entity described in plain object.
   * @param {object} opt
   * @param {boolean} [opt.replace] - If true, replace existing entity with the same id.
   * @param {boolean} [opt.recurse] - If true, nested entities will be added as well.
   * @return {boolean} true if the entity is successfully added.
   */
  addEntity(data, { replace, recurse } = {}) {
    if (!data || !data['@id']) return false;
    let n = this.__getNode(data['@id']);
    let r = this.__updateNode(n, data, { replace, recurse, add: true });
    //if (r && !n[$size]) n[$size] = 1;
    return r;
  }

  /**
   * Add a new identifier as a PropertyValue to the root DataSet.
   * identifier and name are required parameters
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
      if (this.addValues(this.rootId, 'identifier', entity, { duplicate: false })) {
        return entityId;
      }
    }
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
   * Add one or more value to a property of an entity.
   * If the specified property does not exists, a new one will be set. 
   * If the property already exists, the new value will be added to the property array.
   * @param {string|object} idOrEntity - The id or the entity to add the property to
   * @param {string} prop - The name of the property
   * @param {*} values - The value of the property
   * @param {object} opt
   * @param {boolean} [opt.duplicate] - If true, allow a property to have duplicate values in the array
   */
  addValues(idOrEntity, prop, values, { duplicate } = {}) {
    let entity = this.__toNode(idOrEntity);
    if (!entity) throw new Error('Cannot add values to a non-existant entity');
    if (values == null || prop === '@id' || prop === '@reverse') return false;
    let ref = entity[Symbols.$noderef];
    let oldCount = Utils.asArrayRef(entity[prop]).length;
    if (prop in entity) {
      entity[prop] = this.__addValues(ref, prop, entity[prop], values, { duplicate, recurse: true, replace: true, merge: true });
      return Utils.asArrayRef(entity[prop]).length > oldCount;
    } else {
      return this.__setProperty(entity, prop, values, { duplicate, recurse: true, replace: true, merge: true });
    }
  }

  /**
   * Delete an entity from the graph
   * @param {string|Entity} id_or_entity - Entity Identifier or the entity object itself
   * @param {object} opt
   * @param {boolean} [opt.references] - Set true to delete all references to the deleted entity
   * @return True if any existing entity was deleted
   */
  deleteEntity(id_or_entity, { references = false } = {}) {
    const n = this.__toNode(id_or_entity);
    if (n) {
      if (references) {
        for (const p in n['@reverse']) {
          for (const ref of Utils.asArray(n['@reverse'][p])) {
            this.deleteValues(ref['@id'], p, n[$noderef]);
          }
        }
      }
      mapProp(n, (prop, v) => {
        if (v['@id']) removeReverse(n[$noderef], prop, v);
      });
      this.__nodeById.delete(n['@id']);
      n[$proxy]?.revoke();
      n[$proxy] = undefined;
      if (countAllReverse(n[$noderef]) > 0) this.__getNode(n['@id'], n[$noderef]);
      return true;
    }
    return false;
  }

  /**
   * Delete a property of an Entity
   * @param {string|object} idOrEntity - The id of the entity to add the property to
   * @param {string} prop - The name of the property
   * @returns {boolean} - True, if the property has been deleted
   */
  deleteProperty(idOrEntity, prop) {
    if (prop === '@id' || prop === '@reverse' || prop === '@type') throw new Error(`Property ${prop} is not allowed be deleted`);
    let entity = this.__toNode(idOrEntity);
    if (entity && prop in entity) {
      removeAllReverse(entity, [prop]);
      //let r = entity[prop];
      delete entity[prop];
      entity[$size]--;
      return true;
    }
    return false;
  }

  /**
   * Delete one or more values from a property.
   * @param {string|Entity} idOrEntity 
   * @param {string} prop 
   * @param {*} values 
   */
  deleteValues(idOrEntity, prop, values) {
    if (prop === '@id' || prop === '@reverse') throw new Error(`Property ${prop} is not allowed be deleted`);
    let entity = this.__toNode(idOrEntity);
    if (entity && prop in entity) {
      let ids = new Set(mapValue(values, v => v['@id']));
      removeAllReverse(entity, [prop], id => ids.has(id));
      let vals = Utils.asArray(values);
      let r = Utils.asArray(entity[prop]).filter(v => !vals.some(val => Utils.isEqualRef(v, val)));
      if (r.length === 1) {
        entity[prop] = r[0];
      } else if (r.length > 1) {
        entity[prop] = r;
      } else {
        delete entity[prop];
        entity[$size]--;
      }
    }
  }

  /**
   * Set a property of an entity with the given value.
   * If a property with the same name exists, its existing value will be replaced with the specified value.
   * If values contain nested non-empty entities, they will be processed recursively.
   * @param {string|object} idOrEntity - The id of the entity to add the property to
   * @param {string} prop - The name of the property
   * @param {*|Array} values - A value or an array of values
   * @param {Object} opt
   * @param {boolean} [opt.duplicate] - If true, allow a property to have duplicate values
   */
  setProperty(idOrEntity, prop, values, { duplicate } = {}) {
    let entity = this.__toNode(idOrEntity);
    if (!entity) throw new Error('Cannot set property of a non-existant entity');
    if (prop === '@reverse') throw new Error('@reverse property is automaticaly generated and is read only');
    if (prop === '@id') {
      if (typeof values === 'string') return this.updateEntityId(entity, values);
      else return false;
    }
    return this.__setProperty(entity, prop, values, { duplicate, recurse: true });
  }

  /**
   * Update an entity by replacing the object with the same id.
   * This operations will remove all properties of the existing entity and 
   * add the new ones contained in `data`, unless `merge` argument is true.
   * @param {Object} data
   * @param {Object} opt
   * @param {boolean} [opt.merge] - If true, new properties will be merged. Defaults to `config.merge`.
   * @param {boolean} [opt.recurse] - If true, nested entities will be updated as well.
   * @return {boolean} false if there is no existing entity with the same id or data is empty.
   */
  updateEntity(data, { merge, recurse } = {}) {
    let id = data['@id'];
    let n = this.__nodeById.get(id);
    //if (!n) throw new Error('Entity not found');
    if (n && n[$size]) return this.__updateNode(n, data, { replace: true, merge, recurse });
    return false;
  }

  /**
   * Change the identifier of an entity node
   * @param {*} idOrEntity 
   * @param {string} newId 
   */
  updateEntityId(idOrEntity, newId) {
    let n = this.__toNode(idOrEntity);
    if (n) {
      this.__nodeById.delete(n['@id']);
      this.__nodeById.set(newId, n);
      n['@id'] = newId;
      return true;
    }
    return false;
  }


  //////////////////////////////////
  ///////// Public accessor methods

  /**
   * Deep clone the instance of this crate.
   */
  clone() {
    return new ROCrate(this, this.config);
  }

  /**
   * Returns a new iterator object that contains the entities in the graph.
   * @param {Object} p
   * @param {boolean} [p.flat] - If true, return the copy of entity as a plain object.
   * @param {Object|function} [p.filter] - Filter the result based on the values of the properties defined in this object.
   */
  entities({ flat, filter } = {}) {
    var iter = this.__nodeById.values();
    var crate = this;
    var filterFunc = filter;
    var t = typeof filterFunc;
    if (filter && t !== 'function') {
      if (t !== 'object') throw new Error('filter must be a function or object');
      filterFunc = function (entity) {
        var filtered = true;
        for (const key in filter) {
          let r = false;
          for (const v of Utils.asArrayRef(entity[key])) {
            if (!v['@id']) {
              r = r || filter[key].test(v.toString());
            }
          }
          filtered = filtered && r;
        }
        return filtered;
      }
    }
    return {
      [Symbol.iterator]() { return this; },
      next() {
        var r, value;
        while ((r = iter.next()) && !r.done) {
          value = r.value;
          if (value[$size]) {
            value = flat ? value.toJSON() : crate.__getNodeProxy(value);
            if (!filterFunc || filterFunc(value)) {
              return { done: false, value };
            }
          }
        }
        return { done: true, value: null };
      }
    };
  }

  /**
   * Get configuration value
   * @param {'array'|'link'|'replace'|'merge'|'duplicate'} key - Name of the config parameter
   */
  getConfig(key) {
    return this.config[key];
  }

  /**
   * Get the context term definition. This method will also search for term defined locally in the graph.
   * Make sure `resolveContext()` has been called prior calling this method.
   * @param {string} term 
   */
  getDefinition(term) {
    // Find the context term definition from the contextIndex.
    // It will also search for term defined locally in the graph.
    var def = this.__contextTermIndex.get(term);
    if (!def || !def['@id']) {
      const id = this.resolveTerm(term);
      if (id) {
        def = { '@id': id };
      }
    }
    let localDef;
    if (def && def["@id"] && (localDef = this.getEntity(def["@id"]))) {
      let id;
      if ((id = localDef.sameAs?.["@id"])) {
        // There's a same-as - so use its ID
        def["@id"] = id;
        localDef = this.getEntity(id);
      }
      if (localDef && (this.hasType(localDef, "rdfs:Class") || this.hasType(localDef, "rdf:Property"))) {
        def = localDef;
      }
    }
    return def;

  }

  /**
   * Get the context term name from it's definition id.
   * Make sure `resolveContext()` has been called prior calling this method.
   * @param {string|object} definition 
   */
  getTerm(definition) {
    var id = typeof definition === 'string' ? definition : definition['@id'];
    return this.__contextDefinitionIndex.get(id);
  }

  /**
   * Get an entity from the graph. 
   * If config.link is true, any reference (object with just "@id" property)
   * is resolved as a nested object. 
   * @param {string} id An entity identifier
   * @return {Entity} A wrapper for entity that resolves properties as linked objects
   */
  getEntity(id) {
    let n = this.__nodeById.get(id);
    if (n && n[$size]) return this.__getNodeProxy(n);
  }

  /**
   * Check if entity exists in the graph
   * @param {string} id An entity identifier
   */
  hasEntity(id) {
    let n = this.__nodeById.get(id);
    return n?.[$size] > 0;
  }

  /**
   * Get an array of all nodes in the graph. Each node in the array is an Entity instance.
   * If config.link is true, any link to other node will be made into nested object.
   * @param {boolean} flat - If true, return the copy of entity as a plain object.
   * @return {Array}
   */
  getGraph(flat = false) {
    return Array.from(this.entities({ flat }));
  }

  /**
   * Get named identifier
   * @param {string} name 
   * @return {string} the identifier
   */
  getIdentifier(name) {
    const root = this.__toNode(this.rootId);
    /** @type { Array.<{'@id':string, '@type':string, value:string, name:string}> } */
    const identifier = mapValue(root['identifier'], v => {
      const idEntity = this.getEntity(v["@id"]);
      if (idEntity && this.hasType(idEntity, "PropertyValue") && idEntity.name === name) return idEntity;
    });
    if (identifier.length) return identifier[0].value;
  }

  /**
   * Get the property of an entity
   * @param {*} idOrEntity 
   * @param {string} prop 
   * @returns {*} the value of the property
   */
  getProperty(idOrEntity, prop) {
    let node = this.__toNode(idOrEntity);
    if (node) {
      let val = node[prop];
      if (prop === '@id') return val;
      if (prop === '@reverse') return new Proxy(val, this.__handlerReverse);
      if (typeof val === 'function') return val;
      if (val != null) {
        let vals = Utils.asArrayRef(val).map(v => (this.config.link && v?.['@id']) ? this.getEntity(v["@id"]) || v : v);
        return (Array.isArray(val) || this.config.array) ? new Proxy(vals, new ArrayHandler(this.__getNodeProxy(node), prop)) : vals[0];
      }
      return val;
    }
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
    let rootEntity = this.__toNode(root)?.toJSON();
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
                let e = this.__toNode(id);
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
   * Check if an entity has a type
   * @param {*} item 
   * @param {string} type 
   * @return {boolean}
   */
  hasType(item, type) {
    return Utils.hasType(item, type);
  }


  /**
   * Get the index of the entity in the graph array. This is an O(n) operation.
   * @param {string} entityId 
   */
  indexOf(entityId) {
    let count = 0;
    for (const [id, n] of this.__nodeById) {
      if (n[$size]) {
        if (id === entityId) return count;
        ++count;
      }
    }
    return -1;
    //return this.__nodeById.get(id)?.index ?? -1;
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
   * Generate a local flat lookup table for context terms
   */
  async resolveContext() {
    let t = this;
    let results = Array.from(this.__context, async (contextUrl) => {
      if (typeof contextUrl === 'string') {
        if (defaults.standardContexts[contextUrl]) {
          return defaults.standardContexts[contextUrl]["@context"];
        }
        // @ts-ignore
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
    (await Promise.allSettled(results)).forEach(c => c.status === 'fulfilled' && indexContext(c.value, this.__contextTermIndex, this.__contextDefinitionIndex));
    //(await Promise.all(results)).forEach(c => indexContext(c, this.__contextTermIndex, this.__contextDefinitionIndex));
    return {
      getDefinition(term) {
        return t.getDefinition(term);
      },
      getTerm(definition) {
        return t.getTerm(definition);
      }
    };
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
   * Expand a term into the IRI, which is the same as the `@id` of the term definition.
   * Make sure `resolveContext()` has been called prior calling this method.
   * @param {string} term - a short word defined in the context 
   * @return {string} 
   */
  resolveTerm(term) {
    if (!term) return;
    if (term.match(/^http(s?):\/\//i)) {
      return term;
    }
    term = term.replace(/^schema:/, ""); //schema is the default namespace
    var contextIndex = this.__contextTermIndex;
    var val = contextIndex.get(term);
    if (val && val['@id']) val = val['@id'];
    var parts, url;
    if (val && val.match(/^http(s?):\/\//i)) {
      return val;
    } else if (val && (parts = val.match(/(.*?):(.*)/))) {
      url = contextIndex.get(parts[1]);
    } else if ((parts = term.match(/(.*?):(.*)/))) {
      // eg txc:Somthing
      url = contextIndex.get(parts[1]);
    }
    if (url && url.match(/^http(s?):\/\//i)) {
      return `${url}${parts[2]}`;
    }
  }

  /**
   * Convert the rocrate into plain JSON object.
   * The value returned by this method is used when JSON.stringify() is used on the ROCrate object.
   * @return plain JSON object
   */
  toJSON() {
    return { '@context': Array.from(this.__context), '@graph': this.getGraph(true) };
  }

  /**
   * Generate a new unique id that does not match any existing id in the graph.  
   * @param {string} base - The base string of the id.
   * @return {string} The base suffixed with the incremental number. 
   */
  uniqueId(base) {
    var i = 1;
    var uid = base + i;
    while (this.__nodeById.has(uid)) {
      uid = base + (i++);
    }
    return uid;
  }

  /**
   * Transform the property names of all entities by replacing it with the specified prefixes 
   * @param {{[key: string]: string}} prefixes The set of prefixes to use for the compaction
   */
  compactProperties(prefixes) {
    // validate prefixes first
    let validatedPrefixes = [];
    for (let prefix in prefixes) {
      let iriPrefix = prefixes[prefix];
      if ((iriPrefix.endsWith('#') || iriPrefix.endsWith('/'))) {
        let existing = this.resolveTerm(prefix);
        if (!existing) {
          existing = iriPrefix;
          this.addTermDefinition(prefix, iriPrefix);
        } 
        if (existing === iriPrefix) {
          validatedPrefixes.push([prefix, iriPrefix]);
        }
      }
    }
    if (!validatedPrefixes.length) return;

    for (let entity of this.__nodeById.values()) {
      if (entity?.[$size]) {
        for (let prop in entity) {
          if (prop.startsWith('@') || prop.startsWith('_')) continue;
          let iri = this.resolveTerm(prop);
          for (let [prefix, iriPrefix] of validatedPrefixes) {
            let newProp = prefix + ':' + iri.replace(iriPrefix, '');
            if (prop !== newProp && iri.startsWith(iriPrefix)) {
              entity[newProp] = entity[prop];
              delete entity[prop];
              break;
            }
          }
        }
      }
    }
  }

  /////////////////////////////////
  /////////// Experimental methods

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


  /////////////////////////////////
  //////////// Deprecated methods

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
    this.addValues(item['@id'], prop, val, { duplicate: allowDuplicates });
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

///// Helper functions

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
    }
  }
  results[$size] = count;
  return results;
}

function indexContext(c, termIndex, definitionIndex) {
  // Put all the keys into a flat lookup TODO: handle indirection
  if (typeof c === 'object') {
    for (let name in c) {
      const v = c[name];
      if (v) {
        const id = typeof v === 'string' ? v : v["@id"] || name;
        termIndex.set(name, v);
        definitionIndex.set(id, name);
      }
    }
  }
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

function countAllReverse(ref) {
  return Object.values(ref['@reverse']).reduce((count, refs) => count + Utils.asArray(refs).length, 0);
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

function resolveLocalContext(context, termIndex, definitionIndex) {
  for (let c of context) {
    if (typeof c === 'string') {
      c = defaults.standardContexts[c]?.['@context'];
    }
    indexContext(c, termIndex, definitionIndex);
  }
}


// function resetNode(node) {
//   node[$size] = 1;
//   node[$proxy]?.revoke();
//   node[$proxy] = undefined;
// }


module.exports = { ROCrate };
