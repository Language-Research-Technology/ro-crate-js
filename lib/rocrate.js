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

const Entity = require('./entity');
const utils = require('./utils');
const _ = require('lodash');
const defaults = require('./defaults');
const { throws } = require('assert');
const axios = require('axios').default;
//import axios from 'axios';

const VALUE_TYPES = { string: 1, number: 1, boolean: 1 };
/**
 * Class for building, navigating, testing and rendering ROCrates
 * @todo import validation and rendering from Calcyte
 */
class ROCrate {
    static defaults = defaults;

    /**
     * Lookup table to get a reference to an existing or non-existing node.
     * This is needed to avoid searching for the whole graph for every @reverse lookup 
     * and because an entity referenced by other entities may not exist yet in the graph.
     * @type {Map<string, Node>}
     */
    #nodeById = new Map();

    /**
     * Lookup table to get list of entities by their type
     */
    #entityByType = {};

    /** 
     * Internal representation of the context
     */
    #context = {};

    /** 
     * Internal representation of the graph as an array of nodes
     * @type {Node[]} 
     */
    #graph = [];

    #contextIndex = {};

    //#entityByType

    /**
     * Create a new ROCrate object using a default template or from a valid jsonld object.
     * Do not directly modify the json object passed in the parameter.
     * @param {object} json a valid jsonld object
     * @param {object} config
     * @param {boolean} [config.alwaysAsArray] - Always return property of an Entity as an array (eg when using getEntity() method)
     * @param {boolean?} [config.resolveLinks] - Resolve linked node as nested object
     * @param {boolean?} [config.replaceExisting] - When importing from json, always replace existing entity by default
     * @param {boolean?} [config.mergeProperties] - When replacing or updating an entity, merge the values and the properties instead of full replace
     * 
     */
    constructor(json = {}, config = {}) {
        /** @deprecated */
        this.defaults = defaults;
        /** @deprecated */
        this.utils = utils;

        this.config = config;
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
     * @param {object} id Identifier of the node (@id)
     * @returns {Node} a newly created or existing node that matches the id
     */
    #createNode(id) {
        let id_ = id || this.uniqueId('entity-'); // give default id
        let n = this.#nodeById.get(id_);
        if (!n) {
            n = new Node(id_);
            this.#nodeById.set(n.id, n);
        }
        return n;
    }

    /**
     * Add a node to the graph
     * @param {object} data Update the node with the given data
     * @param {boolean} replaceExisting
     * @returns {boolean} Return true if node is sucessfully added to the graph
     */
    #updateNode(n, data, replaceExisting = this.config.replaceExisting) {
        if (n.isValid) {
            if (!replaceExisting || (n.entity === data && n.data === data.$$target)) return false;
            if (!this.config.mergeProperties) {
                // remove existing data first
                mapProp(n.data, (prop, v) => v['@id'] && removeReverse(n.base, prop, v));
                n.resetData();
            }
        } else {
            if (n.index < 0) n.index = this.#graph.push(n) - 1;
            n.deleted = false;
        }
        mapProp(data, (prop, v) => this.#addValues(n.base, prop, n.data[prop], v), n.data);
        // for (let t of utils.asArray(data["@type"])) {
        //     if (!this.#entityByType[t]) this.#entityByType[t] = [];
        //     this.#entityByType[t].push(data);
        // }
        return true;
    }

    #getRawEntity(idOrEntity) {
        if (typeof idOrEntity === 'string') {
            let n = this.#nodeById.get(idOrEntity);
            if (n && n.isValid) return n.data;
        } else {
            return idOrEntity.$$target ?? idOrEntity;
        }
    }

    #addValues(ref, prop, oldValues_, values, allowDuplicates) {
        let oldValues = utils.asArray(oldValues_);
        mapValue(values, v => {
            if (allowDuplicates || !oldValues.some(ov => v['@id'] ? ov['@id'] === v['@id'] : _.isEqual(ov, v))) {
                let nv = v;
                if (typeof v === 'object') {
                    if (v['@id']) {
                        let node = this.#createNode(v['@id']);
                        if (Object.keys(v).length > 1) this.#updateNode(node, v);
                        nv = node.base;
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
        return this.#graph.length;
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
     * Add an entity to the crate.
     * @param {Object} data A valid RO-Crate entity described in plain object.
     * @param {boolean} replaceExisting If true, replace existing entity with the same id.
     * @return {boolean} true if the entity is successfully added.
     */
    addEntity(data, replaceExisting = this.config.replaceExisting) {
        let n = this.#createNode(data['@id']);
        return this.#updateNode(n, data, replaceExisting);
    }

    /**
     * Delete an entity with the specified id
     * @param {string} id 
     * @return {Object} The raw data of deleted entity
     */
    deleteEntity(id) {
        let n = this.#nodeById.get(id);
        if (n != null && n.isValid) {
            mapProp(n.data, (prop, v) => {
                if (v['@id']) removeReverse(n.base, prop, v);
            });
            // removing an arbitrary element one by one from an array is inefficient, mark it as deleted instead
            n.deleted = true;
            return n;
        }
        //return this.#graph.splice(e.index, 1)[0];
    }

    /**
     * Update an entity by replacing the object with the same id.
     * @param {Object} data 
     * @return {boolean} false if there is no existing entity with the same id.
     */
    updateEntity(data) {
        let id = data['@id'];
        if (id && Object.keys(data).length > 1) {
            let n = this.#nodeById.get(id);
            if (n) return this.#updateNode(n, data, true);
        }
        return false;
    }

    /**
     * Change the identifier of an entity node
     * @param {*} idOrEntity 
     * @param {*} newId 
     */
    updateEntityId(idOrEntity, newId) {
        let entity = this.#getRawEntity(idOrEntity);
        let currentId = entity?.['@id'];
        let n = this.#nodeById.get(currentId);
        if (n == null || !n.isValid) return false;
        this.#nodeById.delete(currentId);
        n.id = newId;
        this.#nodeById.set(newId, n);
        return true;
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
        let entity = this.#getRawEntity(idOrEntity);
        if (!entity) throw new Error('Cannot set property of a non-existant entity');
        if (values == null || values === '' || prop === '@reverse') {
           throw new Error('Setting to null, empty not supported');
        }
        let ref = Object.getPrototypeOf(entity);
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
        let entity = this.#getRawEntity(idOrEntity);
        if (!entity) throw new Error('Cannot add property to a non-existant entity');
        if (values == null || values === '' || prop === '@id' || prop === '@reverse') return false;
        let ref = Object.getPrototypeOf(entity);
        let oldCount = utils.asArray(entity[prop]).length;
        entity[prop] = this.#addValues(ref, prop, entity[prop], values, allowDuplicates);
        let newCount = utils.asArray(entity[prop]).length;
        return newCount > oldCount;
    }

    /**
     * Get an entity from the graph. 
     * The entity object is a Proxy that turns references using @id into direct properties
     * @param {string} id An entity identifier
     * @return {*} A wrapper for entity that resolves properties as linked objects
     */
    getEntity(id) {
        let n = this.#nodeById.get(id);
        if (n != null && n.isValid) {
            if (!n.entity) n.entity = new Entity(this, n.data);
            return n.entity;
        }
    }

    /**
     * Get entity index in the graph array
     * @param {*} id 
     */
    getEntityIndex(id) {
        return this.#nodeById.get(id)?.index;
    }

    /**
     * Get an array of all nodes in the graph. Each node in the array is an Entity instance.
     * If config.resolveLinks is true, any link to other node will be made into nested object.
     * @param {boolean} raw - If true, return the internal representation as plain object.
     * @return {Array}
     */
    getGraph(raw = false) {
        this.trim();
        if (raw) {
            return this.#graph.map(n => n.data);
        } else {
            return this.#graph.map(n => n.entity = n.entity ?? new Entity(this, n.data));
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
     * Add a new identifier as a PropertyValue to the root DataSet.
     * identifier and name are required
     * @param {object} options 
     * @param {string} options.name
     * @param {string} options.identifier 
     * @param {string} [options.description]
     * @returns {string}
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
     * @param {*} name 
     * @returns {string} the identifier
     */
    getIdentifier(name) {
        const root = this.#getRawEntity(this.rootId);
        /** @type { Array.<{'@id':string, '@type':string, value:string, name:string}> } */
        const identifier = mapValue(root.identifier, v => {
            const idEntity = this.getEntity(v["@id"]);
            if (idEntity && this.hasType(idEntity, "PropertyValue") && idEntity.name === name) return idEntity;
        });
        if (identifier.length) return identifier[0].value;
    }

    /**
     * Convert the rocrate into plain JSON object.
     * The value returned by this method is used when JSON.stringify() is used on the ROCrate object.
     * @returns plain JSON object
     */
    toJSON() {
        return { '@context': this.#context, '@graph': this.getGraph(true) };
    }

    /**
     * Reduce the size of backing array by removing deleted nodes from the array
     */
    trim() {
        this.#graph = this.#graph.filter(n => {
            if (n.deleted) n.index = -1;
            return !n.deleted;
        });
    }

    /**
     * Return a JSON.stringify-ready tree structure starting from the specified item 
     * with all values (apart from @id) as arrays
     * and string-values expressed like: {"@value": "string-value"}
     * @param {object} opt 
     * @param {string|object} [opt.root]
     * @param {number} [opt.depth] 
     * @param {boolean} [opt.valueObject]
     * @param {boolean} [opt.allowCycle] 
     * @returns {*} the root entity
     */
    getTree({ root = this.rootId, depth = Infinity, valueObject = true, allowCycle = false } = {}) {
        if (depth == Infinity && allowCycle) throw new Error('Option allowCycle must be set to false is depth is not finite');
        root = this.#getRawEntity(root);
        if (!root || depth < 0) return;
        root = utils.clone(root);
        // do a BFS algorithm with queue, instead of DFS with recursion
        let queue = [[root, 0, new Set()]];
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
                                let e = this.#getRawEntity(id);
                                if (e) v = utils.clone(e);
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
        return root;
    }


    resolve(items, pathArray, subgraph) {
        /* 
        pathArray is an array of objects that represents a 'path' through the graph - 
        returns null, or an array of items
        items: A JSON-LD item or array of [item]
        object  must have a "property to follow eg
           resolve(item, {"property": "miltaryService"});
        and optionally a condition "includes", eg
         "includes": {"@type", "Action"}}
        and optionally, a function "matchFn" which takes an item as argument and
        returns a boolean, eg:
         "matchFn": (item) => item['@id'].match(/anzsrc-for/)
     
        subgraph is a boolean - if present and true, all intervening items during
        the traversal will be stored and can be retrieved with the subgraph()
        method
        */
        const p = pathArray.shift();
        const resolvedArray = [];
        const resolvedIds = {};
        items = utils.asArray(items);
        for (let item of items) {
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
        if (resolvedArray.length === 0) {
            return null;
        } else if (pathArray.length > 0) {
            if (subgraph) {
                this._store_in_subgraph(resolvedArray);
            }
            return this.resolve(resolvedArray, pathArray, subgraph);
        } else {
            if (subgraph) {
                this._store_in_subgraph(resolvedArray);
            }
            return resolvedArray; // Found our final list of results
        }
    }

    _store_in_subgraph(resolvedArray) {
        for (let item of resolvedArray) {
            if (!this._subgraph_by_id[item['@id']]) {
                this._subgraph_by_id[item['@id']] = 1;
                this._subgraph.push(item);
            }
        }
    }

    // resolveAll does a resolve but collects and deduplicates intermediate
    // items. Its first returned value is the final items (ie what resolve(..))
    // would have returned.

    resolveAll(items, pathArray) {
        this._subgraph_by_id = {};
        this._subgraph = [];
        const finals = this.resolve(items, pathArray, true);
        return [finals, this._subgraph];
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

    /** @deprecated Not required anymore */
    addBackLinks() { }

    /** @deprecated Moved to {@link JsonldUtils.union} */
    dedupeSubgraphs(subgraphs) {
        return utils.union(...subgraphs);
    }

    /** @deprecated Not required anymore */
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

    /** @deprecated Use {@link ROCrate#toJSON} */
    getJson() { return this.toJSON(); }

    /** @deprecated Use {@link ROCrate#resolveContext#getDefinition} */
    getDefinition(term) {
        return this.#getDefinition(this.#contextIndex, term);
    }

    /** @deprecated Use {@link ROCrate#getIdentifier} */
    getNamedIdentifier(name) {
        return this.getIdentifier(name);
    }

    /** @deprecated */
    serializeGraph() {
        return this.getGraph(true);
    }

    /** @deprecated */
    toGraph() {
        this.config.alwaysAsArray = true;
        this.config.resolveLinks = true;
        return true;
    }

    /** @deprecated */
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
        if (v) indexer[name] = v["@id"] ? v["@id"] : v;
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

/**
 * 
 */
class Node {
    /** @type {number} */
    index = -1;
    /** @type {object} */
    data;
    /** @type {Entity} */
    entity;
    /** @type {boolean} */
    deleted = false;
    /** @type { Partial<{'@id':string, '@reverse':object}> } */
    base;

    constructor(id) {
        if (!id) throw new Error('An entity data must have @id');
        this.base = { "@id": id };
        Object.defineProperty(this.base, '@reverse', { value: {} });
        this.resetData();
        //Object.defineProperty(this.base, '$$owner', { value: this });
    }

    get isValid() {
        return this.index >= 0 && !this.deleted;
    }
    get id() {
        return this.data["@id"];
    }
    set id(id) {
        this.base["@id"] = this.data["@id"] = id;
    }
    resetData() {
        this.entity = null;
        return this.data = Object.create(this.base);
    }
}

module.exports = ROCrate;
