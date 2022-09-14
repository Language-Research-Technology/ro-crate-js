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

const { Node, Handler, Symbols } = require('./node');
const utils = require('./utils');
const _ = require('lodash');
const defaults = require('./defaults');
const { throws } = require('assert');
const { count } = require('console');
const axios = require('axios').default;
//import axios from 'axios';

const VALUE_TYPES = { string: 1, number: 1, boolean: 1 };
const UPDATE_MODE = { MERGE: 'MERGE', REPLACE: 'REPLACE' };
/**
 * @typedef {import('./node').RawEntity} RawEntity
 * @typedef {import('./node').Entity} Entity
 * @typedef {import('./node').NodeRef} NodeRef
 */
/**
 * @typedef {object} NodeAux
 * @property {Node} [node]
 * @property {{ proxy: Entity; revoke: () => void; }} [entity] - A cache for the proxy object
 * @property {NodeRef} ref - Node reference
 */

/**
 * Class for building, navigating, testing and rendering ROCrates
 * @todo import validation and rendering from Calcyte
 */
class ROCrate {
  static defaults = defaults;

  /**
   * Lookup table to get a reference to existing and non-existing nodes.
   * This is needed to avoid searching for the whole graph for every "@reverse" lookup 
   * and because an entity referenced by other entities may not exist yet in the graph.
   * @type {Map<string, NodeAux>}
   */
  #nodeById = new Map();

  #handler;
  /**
   * Lookup table to get list of entities by their type
   */
  #entityByType = {};

  /** 
   * Internal representation of the context
   */
  #context = {};

  #contextIndex = {};

  //#entityByType
  /** @deprecated */
  defaults = defaults;
  /** @deprecated */
  utils = utils;

  /**
   * Create a new ROCrate object using a default template or from a valid jsonld object.
   * @param {object} json a valid jsonld object
   * @param {object} config
   * @param {boolean} [config.alwaysAsArray] - Always return property of an Entity as an array (eg when using getEntity() method)
   * @param {boolean} [config.resolveLinks] - Resolve linked node as nested object
   * @param {boolean} [config.replaceExisting] - When importing from json, always replace existing entity by default
   * @param {boolean} [config.mergeProperties] - When replacing or updating an entity, merge the values and the properties instead of full replace
   * 
   */
  constructor(json = {}, config = {}) {
    this.config = config;
    this.#handler = new Handler(this);
    //this.defaultMetadataIds = new Set(defaults.roCrateMetadataIDs);
    // init graph
    this.#context = json["@context"] || defaults.context;
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
   * @returns {NodeAux} a newly created or existing node that matches the id
   */
  #getNodeAux(id) {
    let n = this.#nodeById.get(id);
    if (!n) {
      let ref = /** @type {*} */ ({ "@id": id || this.uniqueId('entity-') });
      Object.defineProperty(ref, '@reverse', { value: {} });
      n = { ref };
      this.#nodeById.set(id, n);
    }
    return n;
  }


  /**
   * Return a proxy that wraps a node as an entity object supporting linked objects capability.
   * @param {NodeAux} n 
   */
  #getNodeProxy(n) {
    if (!n.entity) n.entity = Proxy.revocable(n.node, this.#handler);
    return n.entity.proxy;
  }

  /**
   * Add a node to the graph
   * @param {NodeAux} n
   * @param {object} data Update the node with the given data
   * @param {boolean} [replaceExisting]
   * @param {boolean} [mergeProperties]
   * @returns {boolean} Return true if node is sucessfully added to the graph
   */
  #updateNode(n, data, replaceExisting = this.config.replaceExisting, mergeProperties = this.config.mergeProperties) {
    if (n.node) {
      if (!replaceExisting || n.entity?.proxy === data) return false;
      if (!mergeProperties) {
        // remove existing data first
        mapProp(n.node, (prop, v) => v['@id'] && removeReverse(n.ref, prop, v));
        n.node = new Node(n.ref);
        n.entity?.revoke();
        n.entity = undefined;
      }
    } else {
      n.node = new Node(n.ref);
      n.entity?.revoke();
      n.entity = undefined;
    }
    let node = n.node;
    mapProp(data, (prop, v) => this.#addValues(n.ref, prop, node[prop], v), node);
    // for (let t of utils.asArray(data["@type"])) {
    //     if (!this.#entityByType[t]) this.#entityByType[t] = [];
    //     this.#entityByType[t].push(data);
    // }
    return true;
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
        if (!node) id = idOrEntity['@id'];
        // if (!node) {
        //   if (idOrEntity instanceof Node) node = idOrEntity;
        //   else id = idOrEntity['@id'];
        // }
        break;
    }
    return node || this.#nodeById.get(id)?.node;
  }

  #addValues(ref, prop, oldValues_, values, allowDuplicates) {
    let oldValues = utils.asArray(oldValues_);
    mapValue(values, v => {
      if (allowDuplicates || !oldValues.some(ov => v['@id'] ? ov['@id'] === v['@id'] : _.isEqual(ov, v))) {
        let nv = v;
        if (typeof v === 'object') {
          if (v['@id']) {
            let node = this.#getNodeAux(v['@id']);
            if (Object.keys(v).length > 1) this.#updateNode(node, v);
            nv = node.ref;
            addReverse(ref, prop, nv);
          } else {
            nv = JSON.parse(JSON.stringify(v));
          }
        }
        oldValues.push(nv);
      }
    });
    return oldValues.length === 1 ? oldValues[0] : oldValues;
  }

  /**
   * An array of all nodes in the graph
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
      if (e != null && utils.hasType(e, "CreativeWork")) {
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
    return new ROCrate(this.toJSON(), this.config);
  }

  /**
   * Add an entity to the crate.
   * @param {object} data A valid RO-Crate entity described in plain object.
   * @param {boolean} [replaceExisting] If true, replace existing entity with the same id.
   * @return {boolean} true if the entity is successfully added.
   */
  addEntity(data, replaceExisting = this.config.replaceExisting) {
    let n = this.#getNodeAux(data['@id']);
    return this.#updateNode(n, data, replaceExisting);
  }

  /**
   * Delete an entity from the graph
   * @param {string|Entity} id_or_entity - Entity Identifier or the entity object itself
   * @return {RawEntity|undefined} If success, return the raw data of deleted entity
   */
  deleteEntity(id_or_entity) {
    const id = typeof id_or_entity === 'string' ? id_or_entity : id_or_entity['@id'];
    const n = this.#nodeById.get(id);
    if (n && n.node) {
      mapProp(n.node, (prop, v) => {
        if (v['@id']) removeReverse(n.ref, prop, v);
      });
      this.#nodeById.delete(id);
      return n.node.toJSON();
    }
  }

  /**
   * Update an entity by replacing the object with the same id.
   * @param {Object} data 
   * @param {boolean} [mergeProperties] - If true, new properties will be merged 
   * @return {boolean} false if there is no existing entity with the same id or data is empty.
   */
  updateEntity(data, mergeProperties = this.config.mergeProperties) {
    let id = data['@id'];
    let n = this.#nodeById.get(id);
    if (n && n.node && utils.countProp(data) > 1) return this.#updateNode(n, data, true);
    return false;
  }

  /**
   * Change the identifier of an entity node
   * @param {*} idOrEntity 
   * @param {*} newId 
   */
  updateEntityId(idOrEntity, newId) {
    let entity = this.#toNode(idOrEntity);
    let currentId = entity?.['@id'];
    let n = this.#nodeById.get(currentId);
    if (n && n.node) {
      this.#nodeById.delete(currentId);
      n.node['@id'] = newId;
      this.#nodeById.set(newId, n);
      return true;
    }
    return false;
  }

  /**
   * Get the property of an entity
   * @param {*} idOrEntity 
   * @param {*} prop 
   * @returns {*} the value of the property
   */
  getProperty(idOrEntity, prop) {
    let e = (typeof idOrEntity === 'string') ? this.getEntity(idOrEntity) : idOrEntity;
    if (e) {
      return e[prop];
    }
  }

  /**
   * Set the property with the given value.
   * If a property with the same name exists, its existing value will be replaced with the specified value.
   * Properties of nested objects will not be processed.
   * @param {string|object} idOrEntity - The id of the entity to add the property to
   * @param {string} prop - The name of the property
   * @param {*|Array} values - A value or an array of values. If value is an array, wrap it first in another array.
   */
  setProperty(idOrEntity, prop, values, allowDuplicates = false) {
    let entity = this.#toNode(idOrEntity);
    if (!entity) throw new Error('Cannot set property of a non-existant entity');
    if (values == null || values === '' || prop === '@reverse') return;
    let ref = entity[Symbols.$noderef];
    if (prop === '@id') {
      if (typeof values === 'string') return this.updateEntityId(entity[prop], values);
    } else {
      // find entity ref that must be removed
      let newIds = new Set(mapValue(values, v => v['@id']));
      mapValue(entity[prop], v => !newIds.has(v['@id']) && removeReverse(ref, prop, v));
      entity[prop] = this.#addValues(ref, prop, [], values, allowDuplicates);
      return true;
    }
  }

  /**
   * Add one or more value to a property of an entity.
   * If the specified property does not exists, a new one will be set. 
   * If the property already exists, the new value will be added to the property array.
   * @param {string|object} idOrEntity - The id or the entity to add the property to
   * @param {string} prop - The name of the property
   * @param {*} values - The value of the property
   * @param {boolean} allowDuplicates - If true, allow a property to have duplicate values in the array
   */
  addValues(idOrEntity, prop, values, allowDuplicates = false) {
    let entity = this.#toNode(idOrEntity);
    if (!entity) throw new Error('Cannot add property to a non-existant entity');
    if (values == null || values === '' || prop === '@id' || prop === '@reverse') return false;
    let ref = entity[Symbols.$noderef];
    let oldCount = utils.asArray(entity[prop]).length;
    entity[prop] = this.#addValues(ref, prop, entity[prop], values, allowDuplicates);
    let newCount = utils.asArray(entity[prop]).length;
    return newCount > oldCount;
  }

  /**
   * Get configuration value
   * @param {'alwaysAsArray'|'resolveLinks'|'replaceExisting'|'mergeProperties'} key - Name of the config parameter
   */
  getConfig(key) {
    return this.config[key];
  }

  /**
   * Get an entity from the graph. 
   * If config.resolveLinks is true, any reference (object with just "@id" property)
   * is resolved as a nested object. 
   * @param {string} id An entity identifier
   * @return {Entity|undefined} A wrapper for entity that resolves properties as linked objects
   */
  getEntity(id) {
    let n = this.#nodeById.get(id);
    if (n && n.node) {
      return this.#getNodeProxy(n);
    }
  }

  /**
   * Get the index of the entity in the graph array. This is an O(n) operation.
   * @param {string} entityId 
   */
  indexOf(entityId) {
    let count = 0;
    for (const [id, n] of this.#nodeById) {
      if (n.node) {
        if (id === entityId) return count;
        ++count;
      }
    }
    return -1;
    //return this.#nodeById.get(id)?.index ?? -1;
  }

  /**
   * Get an array of all nodes in the graph. Each node in the array is an Entity instance.
   * If config.resolveLinks is true, any link to other node will be made into nested object.
   * @param {boolean} raw - If true, return the internal representation as plain object.
   * @return {Array}
   */
  getGraph(raw = false) {
    var g = [];
    for (const n of this.#nodeById.values()) {
      if (n.node) {
        let e = raw ? n.node.toJSON() : this.#getNodeProxy(n);
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
   * @return the identifier
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
   * and string-values expressed like: {"@value": "string-value"}
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
          node[prop] = utils.asArray(val);
        } else if (prop === "@reverse") {
          delete node[prop];
        } else if (prop !== "@id") {
          node[prop] = utils.asArray(val).map(v => {
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
   * @param {*[]} subgraph - If present and true, all intervening items during
   *   the traversal will be stored. If an array is passed, the intervening items will be
   *   stored in the array.
   * @return {*[]|null} null, or an array of items
   */
  resolve(items, pathArray, subgraph) {
    const p = pathArray.shift();
    const resolvedArray = [];
    const resolvedIds = {};
    items = utils.asArray(items);
    for (let item of items) {
      item = this.getEntity(item['@id']);
      if (p["@reverse"] && item["@reverse"]) {
        item = item["@reverse"];
      }

      if (item[p.property]) {
        for (let val of utils.asArray(item[p.property])) {
          if (val["@id"] && this.getItem(val["@id"])) {
            const id = val["@id"];
            if (!resolvedIds[id]) {
              const potentialItem = this.getItem(val["@id"]);
              if (p.includes) {
                for (let inc of Object.keys(p.includes)) {
                  if (utils.asArray(potentialItem[inc]).includes(p.includes[inc])) {
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

  // resolveAll does a resolve but collects and deduplicates intermediate
  // items. Its first returned value is the final items (ie what resolve(..))
  // would have returned.

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


  // Experimental method to turn a graph into a flat dictionary eg for turning it into a table
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
            const valPropPath = `${newPropPath}_${valCount++}`
            if (val["@id"]) {
              // It's a nested object
              // TODO - recurse
              if (depth > 0 && !seen[val["@id"]]) {
                this.flatify(val, depth - 1, flatItem, valPropPath + "_", seen)
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

  objectify() {
    // Create a simple tree-like object - but don't make circular structures
    return this.getTree({ valueObject: false });
  }


  /**
   * Generate a local flat lookup table for context terms
   */
  async resolveContext() {
    let t = this;
    let results = utils.asArray(this.#context).map(async (contextUrl) => {
      if (typeof contextUrl === 'string') {
        if (defaults.standardContexts[contextUrl]) {
          return defaults.standardContexts[contextUrl]["@context"];
        }
        try {
          const response = await axios.get(contextUrl, {
            headers: {
              'accept': "application/ld+json, application/ld+json, text/text"
            }
          });
          return response.data["@context"];
        } catch (error) {
          /** @todo: remove this */
          console.error(error);
        }
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
   * Add context
   * @param {*} context 
   */
  addContext(context) {
    this.#context = utils.asArray(this.#context);
    this.#context.push(context);
    indexContext(this.#contextIndex, context);
  }

  resolveTerm(term) {
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
    return utils.hasType(item, type);
  }

  /** @deprecated Use {@link ROCrate#resolveContext} */
  get context() {
    return this.#context;
  }

  /**
   * Alias for addEntity
   * This silently fails if the item has no @id or already exists - this is probably sub-optimal
   * @param {*} item 
   * @deprecated 
   */
  addItem(item) {
    return this.addEntity(item);
  }

  /**
   * Alias for {@link deleteEntity}
   * @param {string} id 
   * @return {Object} The raw data of deleted entity
   * @deprecated 
   */
  deleteItem(id) {
    return this.deleteEntity(id);
  }

  /** @deprecated Not required anymore. Calling this method will do nothing. */
  addBackLinks() { }

  /** @deprecated Use {@link utils.union}, eg: union([sg1, sg2]) */
  dedupeSubgraphs(subgraphs) {
    return utils.union(...subgraphs);
  }

  /** @deprecated Not required anymore. Calling this method will do nothing. */
  index() { }

  /**
   * Add a value to an item's property array
   * @param {*} item 
   * @param {*} prop 
   * @param {*} val 
   * @param {*} allowDuplicates 
   * @deprecated 
   */
  pushValue(item, prop, val, allowDuplicates = false) {
    this.addValues(item['@id'], prop, val, allowDuplicates);
  }

  /** @deprecated Use {@link ROCrate#updateEntityId} */
  changeGraphId(item, newId) {
    return this.updateEntityId(item['@id'], newId);
  }

  /**
   * Alias for {@link getEntity}
   * @param {*} id 
   * @returns {*} entity
   * @deprecated 
   */
  getItem(id) {
    return this.getEntity(id);
  }

  /** @deprecated Use {@link ROCrate#getGraph(true)} */
  getFlatGraph() {
    return this.getGraph(true);
  }

  /** @deprecated Use {@link ROCrate#rootDataset} */
  getRootDataset() {
    return this.rootDataset;
  }

  /** @deprecated Use {@link ROCrate#rootId} */
  getRootId() {
    return this.rootId;
  }

  /** @deprecated Use {@link ROCrate.toJSON} */
  getJson() { return this.toJSON(); }

  /** @deprecated Use {@link ROCrate#resolveContext#getDefinition} */
  getDefinition(term) {
    return this.#getDefinition(this.#contextIndex, term);
  }

  /** @deprecated Use {@link ROCrate.getIdentifier} */
  getNamedIdentifier(name) {
    return this.getIdentifier(name);
  }

  /** @deprecated Use {@link ROCrate.getGraph} and pass true as the argument */
  serializeGraph() {
    return this.getGraph(true);
  }

  /** @deprecated Specify `{alwaysAsArray: true, resolveLinks: true}` in the options when creating the ROCrate instance */
  toGraph() {
    this.config.alwaysAsArray = true;
    this.config.resolveLinks = true;
    return true;
  }

  /** @deprecated Use {@link ROCrate.getTree} with the following argument: `{ root, depth, allowCycle: true }` */
  getNormalizedTree(root, depth = 1) {
    return this.getTree({ root, depth, allowCycle: true });
  }
}

/**
 * Iterate over values of a property of an entity and return filtered and mapped results.
 * @param {*} val - A value or an array of values that will be iterated over
 * @param {function} fn - Call this function for each reference in each value
 */
function mapValue(val, fn) {
  let results = [];
  for (let v of utils.asArray(val)) {
    if (v != null) {
      let result = fn(v);
      if (result != null) results.push(result);
    }
  }
  return results;
}

function mapProp(entity, fn, results = {}) {
  for (let prop in entity) {
    let r = mapValue(entity[prop], v => fn(prop, v));
    r = r.length > 1 ? r : r[0];
    if (r) {
      results[prop] = r;
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

function removeProperty(entity, prop, onlyValue = false) {
  let id = entity['@id'];
  mapValue(entity[prop], val => removeReverse(val, prop));
  if (onlyValue) entity[prop] = null;
  else delete entity[prop];
}

function isNodeRef(def, obj) {
  return (typeof obj === "string" && def["@type"] === "@id") ||
    (typeof obj === "object" && obj["@id"] && Object.keys(obj).length === 1);
}
function isNode(def, obj) {

}
function createProxy() {

}


module.exports = ROCrate;
