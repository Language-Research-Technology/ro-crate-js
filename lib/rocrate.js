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

const utils = require('./utils');
const _ = require('lodash');
//const { isArray} = require("lodash");
const axios = require('axios');

const defaults = require('./defaults');
//const axios = require('axios').default;
//import axios from 'axios';

/**
 * Class for building, navigating, testing and rendering ROCrates
 * @todo import validation and rendering from Calcyte
 */
class ROCrate {

    /**
     * Create a new ROCrate object from a valid jsonld object
     * @param {Object} json 
     */
    constructor(json) {
        this.defaults = defaults;

        if  (!json) {
            var root = _.clone(this.defaults.datasetTemplate);
            this.json_ld = {
                "@context": this.defaults.context,
                "@graph":  [
                    root,
                    _.clone(this.defaults.metadataFileDescriptorTemplate)
                ]
            }
        } else {
            this.json_ld = json;
        }
        this.utils = new utils();
    }

    /**
     * 
     */
    index() {
        this.__item_by_id = {};
        this.__ordered_ids = [];
        this.__item_by_type = {}; // dict of arrays
        this.__graph = this.json_ld["@graph"] ? this.json_ld["@graph"] : [];
        this._identifiers = {}; // Local IDs
        for (let i = 0; i < this.__graph.length; i++) {
            var item = this.__graph[i];
            
            if (!item["@id"]) {
                item["@id"] = `#${i}`;
            }   
            this.__item_by_id[item["@id"]] = item;
            this.__ordered_ids.push(item["@id"]);
            for (let t of this.utils.asArray(item["@type"])) {
                if (!this.__item_by_type[t]) {
                    this.__item_by_type[t] = [];
                }
                if (t === "CreativeWork"  &&  this.defaults.roCrateMetadataIDs.includes(item["@id"])) {
                    this._rootId = item.about["@id"];
                    this.metadataFileEntity = item;
                }
                this.__item_by_type[t].push(item);
            }
        }

        if (this._rootId) {
            this._rootNode = this.__item_by_id[this._rootId];
            if (this._rootNode === undefined) {
                throw new Error("There is no root dataset");
            }
            for (var id of this.utils.asArray(this._rootNode["identifier"])){
                const idEntity = this.getItem(id["@id"]);
                if (idEntity && this.hasType(idEntity, "PropertyValue")) {
                    this._identifiers[idEntity.name] = idEntity.value;
                }
            }
        } 
        else {
            throw new Error("There is no pointer to the root dataset")
        }
    }

    _indexItem(item) {
        // TODO - update these methods
        if (item["@id"]) {
            if (this.__graphIndex) { 
                this.__graphIndex[item["@id"]] = item;
            } else {
                 if (!this.__item_by_id) {
                     this.index();
                 }
                 this.__item_by_id[item["@id"]] = item;
            }
        } 
        for (let t of this.utils.asArray(item["@type"])) {
            if (!this.__item_by_type[t]) {
                this.__item_by_type[t] = [];
            }
            this.__item_by_type[t].push(item);
        }
    }

    /**
     * Add an item to in whatever mode we're working.
     * This silently fails if the item has no @id or already exists - this is probably sub-optimal
     * @param {*} item 
     * @return {boolean}
     * @todo exceptions? 
     */
    addItem(item) {
        if( !item['@id'] ) {
            return false;
        }
        // Check which mode we're working in 
        if (this.__graphIndex) {
            // New linked graph mode
            if (this.__graphIndex[item['@id']]) {
                return false; // can't use this method to update an existing item
            } 
            this.__graphArray.push(item);
            this.__ordered_ids.push(item["@id"]);
            this.itemToGraph(item, this.__graphIndex);
        } else {
            // Old graph-as array mode
            if( this.__item_by_id[item['@id']] ) {
                return false; // can't use this method to update an existing item
             }
            this.__graph.push(item);
            this._indexItem(item);

        }
        return true;
    }

  

    // TODO - new helper methods...
    deleteItem() {
        // 
    }

    updateItem() {
       // 
    }

    // Add a value to an item's property array
    pushValue(item, prop, val, allowDuplicates = false) {
        item[prop] = this.utils.asArray(item[prop]);
        // Check for duplicates
        if (!allowDuplicates && val["@id"]) {
            for (let existingValue of item[prop]) {
                if (existingValue["@id"] && existingValue["@id"] === val["@id"]) {
                    return
                }
            }
        }
       

        if (this.__graphIndex) {
            //We're in Graph mode so be smart about this
            if (val["@id"]) {
                val = this.itemToGraph(val, this.__graphIndex);
            }

        }

        item[prop].push(val);
        
    }

    // This works differently in "Old" and "new" mode
    getItem(id) {
       if (this.__item_by_id === false) {
           // New mode
           return this.__graphIndex[id];
       } else { 
        // Old mode
        if (!this.__item_by_id) {
            this.index();
        }
        return this.__item_by_id[id];
       }
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
      items = this.utils.asArray(items);
      for (let item of items) {
        if (p["@reverse"] && item["@reverse"]) {
          item = item["@reverse"];
        }
        
        if (item[p.property]) {
            for (let val of this.utils.asArray(item[p.property])) {
                if (val["@id"] && this.getItem(val["@id"])){
                    const id = val["@id"];
                    if( !resolvedIds[id] ) {
                        const potentialItem = this.getItem(val["@id"]);
                        if (p.includes) {
                            for (let inc of Object.keys(p.includes)) {
                                if (this.utils.asArray(potentialItem[inc]).includes(p.includes[inc])){
                                    resolvedArray.push(potentialItem);
                                    resolvedIds[id] = 1;
                                }
                            }
                        } else if(p.matchFn) {
                            if( p.matchFn(potentialItem) ) {
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
            if( subgraph ) {
                this._store_in_subgraph(resolvedArray);
            }
            return this.resolve(resolvedArray, pathArray, subgraph);
        } else {
            if( subgraph ) {
                this._store_in_subgraph(resolvedArray);
            }
            return resolvedArray; // Found our final list of results
        }
    }

    _store_in_subgraph(resolvedArray) {
        for( let item of resolvedArray ) {
            if( !this._subgraph_by_id[item['@id']] ) {
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
        return [ finals, this._subgraph ];
    }

    dedupeSubgraphs(subgraphs) {
        return _.uniqBy(_.flatMap(subgraphs), (i) => i['@id']);
    }

    hasType(item, type) {
        return this.utils.asArray(item["@type"]).includes(type);
    }

    getFlatGraph() {
        if (this.__graphIndex) {
            return this.serializeGraph();
        } else {
             return this.json_ld["@graph"];
        }
    }

    getRootDataset() {
        if (!this._rootNode) {
            this.index();
        }
        return this._rootNode;
    }

    getRootId() {
        if (!this._rootId) {
            this.index();
        }
        return this._rootId;
    }
    getJson() {
        if (this.__graphArray) {
            const json = this.json_ld
            json["@graph"] = this.serializeGraph();
            return json;
        } 

        return this.json_ld;
        
    }

    getNamedIdentifier(name) {
        return this._identifiers[name];
    }

    uniqueId(base) {
        var i = 1;
        var uid = base;
        while( uid in this.__item_by_id ) {
            uid = base + String(i);
            i++;
        }
        return uid;   
    }

    // addIdentifier: add a new identifier as a PropertyValue to the
    // root DataSet. 

    // params: { name:, identifier:, description: }
    
    // identifier and name are compulsory

    addIdentifier(options) {
        if (!this.__item_by_id) {
            this.index();
        }
        if( !options['identifier'] || !options['name'] ) {
            return false;
        }
        const root = this._rootNode;
        if( !root ) {
            return false;
        }
        if( !root['identifier'] ) {
            root['identifier'] = [];
        } else {
            if( !Array.isArray(root['identifier']) ) {
                root['identifier'] = [ root['identifier'] ];
            }
        }
        const newItemID = `_:local-id:${options['name']}:${options['identifier']}`;
        const item = {
            '@id': newItemID,
            '@type': 'PropertyValue',
            value: options['identifier'],
            name: options['name']
        };
       
        if( options['description'] ) {
            item['description'] = options['description'];
        }
        if( this.addItem(item) ) {
            root['identifier'].push({ '@id': newItemID});
            this._identifiers[options.name] = options.identifier;
            return newItemID;
        } 
        return false;
    }

    // See if a value (could be a string or an object) is a reference to something
    referenceToItem(value) {
        // Check if node is a reference to something else
        // If it is, return the something else
        if (value["@id"] && this.getItem(value["@id"])) {
            return this.getItem(value["@id"]);
        }
        else {
            return null
        }
    }

    backLinkItem (item) {
        for (let key of Object.keys(item)) {
            if (key != "@id" && key != "@reverse") {
                for (let part of this.utils.asArray(item[key])) {         
                    var target = this.referenceToItem(part);
                    var back_link =  this.defaults.back_links[key];
                    // Dealing with one of the known stuctural properties
                    if (target && back_link) {
                        if (!target[back_link]) {
                            target[back_link] = [{ "@id": item["@id"] }];
                        } else {
                            this.utils.asArray(target[back_link]).push({ "@id": item["@id"] });
                        }
                    } else if (
                        !back_link && target && !this.defaults.back_back_links.has(key)
                    ) {
                        // We are linking to something
                        //console.log("Doing a back link", key, target['name'], item['name'])
                        if (!target["@reverse"]) {
                            target["@reverse"] = {};
                        }
                        if (!target["@reverse"][key]) {
                            target["@reverse"][key] = [];
                        }

                        var got_this_already = false;
                        for (let r of target["@reverse"][key]) {
                          if (r["@id"] === item["@id"]) {
                            got_this_already = true
                           }
                        }
                        if (!got_this_already) {
                            //console.log("Back linking", key)
                            target["@reverse"][key].push({ "@id": item["@id"] });
                        }
                        //console.log(JSON.stringify(target, null, 2))
                    }
                }
            }
        }
    }

    addBackLinks() {
        if (!this.__graphIndex) {
        for (let item of this.__graph) {
            delete item["@reverse"];
        }
        for (let item of this.__graph) {
            this.backLinkItem(item);
        }
    }
    }

   toGraph() {
    //turn an entire crate into a linked data structure once this is done you can no longer operate in "old" mode directly with the graph array
        if (this.__graphIndex) {
            // Already done
            return false;
        }
        if (!this.__item_by_id) {
            this.index();
        }

        var g = this.getGraph(); 
        this.__graphIndex = {}; // New Index
        this.__graphArray = []; //New array
        for (let item of g){
            // Turn references using @id into direct properties
            this.itemToGraph(item,  this.__graphIndex);
            
        }
        this.__item_by_id = false; // Not to be used any more - we have changed our data structure
        this.__graphArray = g.concat(this.__graphArray); //New array with all the existing elments first and
        this.json_ld["@graph"] = [];
        ; // Save space
        return true;
   }

   getNormalizedTree(item, depth) {
       // Return a JSON-strigify-ready tree structure starting from an item with all values (apart from @id) as arrays
       // and string-values expressed like: {"@value": "string-value"}
       // TODO: Might 
       
       const newItem = {};
       if (typeof item  === 'string' || item instanceof String) {
            return({"@value": item})    
       } else if (depth < 0){
           return;
       } if (depth === 0) {
           const finalItem = {}
           if (item.name)  {
               finalItem.name = [];
               for (let n of this.utils.asArray(item.name)) {
                    finalItem.name.push(this.getNormalizedTree(n, depth));
               } 
           } if (item["@id"]) {
               finalItem["@id"] = item["@id"];
           }
           return finalItem;
       }
       
       for (let prop of Object.keys(item)) {
            if (prop === "@id" || prop === "@value") {
                newItem[prop] = item[prop];
            } else if (prop === "@type") {
                newItem["@type"] = this.utils.asArray(item["@type"])
            } else if (prop === "@reverse"){
                // Do nothing
            }
            else {
                const newVals = [];
                for (let val of this.utils.asArray(item[prop])) {
                    newVals.push(this.getNormalizedTree(val, depth - 1));
                    //console.log(newVals);
                }
                newItem[prop] = newVals;
            }
       }
       return newItem;

   }



   getGraph() {
    // Return a linked array of all items
    if (this.__graphIndex) {
         return this.__graphArray;
    } else {
        return this.json_ld["@graph"];
    }
   }

   
   serializeGraph() {
       const me = this;
       const deLink = function (item) {
            const newItem = {}
            for (let prop of Object.keys(item)) {
                if (prop === "@id") {
                    newItem["@id"] = item[prop];
                } else  if (prop === "@reverse") {
                    delete item["@reverse"];
                    // Do anything?
                } else {
                    const newVals = [];
                    for (let val of me.utils.asArray(item[prop])) {
                        if (val["@id"]) {
                            // This is a reference to another object so turn it into a JSON-LD reference
                            newVals.push({"@id": val["@id"]})
                        } else {
                            newVals.push(val);
                        }
                    }
                    if (newVals.length == 1) {
                        newItem[prop] = newVals[0];
                    } else {
                        newItem[prop] = newVals;
                    }
                }
            }
            return newItem;

        }
       const newGraph = [];

        // Add in any stray items that may have been embedded in other items - not in the graphArray
     
        for (let item of this.__graphArray){
            newGraph.push(deLink(item));
        }
        // Add in any stray objects  - should not ever go off  
        for (let key of Object.keys(this.__graphIndex)) {
            const item = this.__graphIndex[key];
            if (!this.__ordered_ids.includes(key)) {
                newGraph.push(deLink(item));
                }
        }
        
        return newGraph;
    
   }

   // Change the ID of an item
   changeGraphId(item, newID) {
       delete this.__graphIndex[item["@id"]];
       const location = this.__ordered_ids.indexOf(item["@id"]);
       this.__ordered_ids[location] = newID;
       item["@id"] = newID;

       this.__graphIndex[newID] = item;
   }

 

   itemToGraph(item, alreadySeen) {
    const addReverse = function (newItemVal, item, prop) {
        newItemVal["@reverse"] = newItemVal["@reverse"] || [];
        if (!newItemVal["@reverse"][prop]) {
            newItemVal["@reverse"][prop] = [];
        }
        newItemVal["@reverse"][prop].push(item); // Link back to the item we're processing
     
    }

    if (!alreadySeen[item["@id"]]) {
        alreadySeen[item["@id"]] = item;
        if (!this.__ordered_ids.includes(item["@id"])) {
            this.__ordered_ids.push(item["@id"]);
        }

        item["@reverse"] = {};
        for (let prop of Object.keys(item)) {
            if (prop === "@type") {
                item["@type"] = this.utils.asArray(item["@type"]).sort();
                for (let t of item["@type"]) {
                    if (!this.__item_by_type[t]){
                        this.__item_by_type[t] = [];
                    }
                    this.__item_by_type[t].push(item)
                }
            } else if (prop === "@reverse") {
                delete prop["@reverse"]; // Will add our own
            } else if (prop != "@id" && prop != "@reverse") {
                var newVals = [];

                for (let val of this.utils.asArray(item[prop])){
                  
                    if (val["@id"]) { // This is a reference
                        var nested = this.getItem(val["@id"]);
                     
                        if (nested) {
                            if (alreadySeen[val["@id"]]) {
                                newVals.push(nested);
                                addReverse(nested, item, prop)
                            } else { 
                                const newItemVal = this.itemToGraph(nested, alreadySeen);
                                newVals.push(newItemVal);
                                addReverse(newItemVal, item, prop)
                                    //TODO: Add reverse                  
                                }
                            
                        } else { // NOT FOUND SO ADD VERTBATIM
                            
                            newVals.push(val);
                        }

                    } else {
                        newVals.push(val);
                    }
                }
            // TODO: 
            item[prop] = newVals;
            }
        }
    }
    return item;    
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
                    for (let val of item[prop]){
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
        this.index();
        const root = _.clone(this.getRootDataset());
        this.nest(root, {});
        this.objectified = root;    
    }

    nest(item, alreadySeen) {
        if (!alreadySeen[item["@id"]]) {
            alreadySeen[item["@id"]] = true;
            for (let prop of Object.keys(item)) {
                var newValues = [];
                for (let val of this.utils.asArray(item[prop])){
                    if (val["@id"]) {
                        var nested = this.getItem(val["@id"]);
                        if (nested)  {
                            var newVal = this.nest(nested, _.clone(alreadySeen));
                            if (newVal) {
                                newValues.push(newVal);
                                continue;
                            }               
                        }      
                    }
                    newValues.push(val)       
                }
        
                item[prop] = newValues;
                
            }
            return item;    
        }
       
    }

   
     // Get a local flat lookup table for context terms
     async resolveContext() {
        this.context = {};
        var cont = {};
        for (let contextUrl of  this.utils.asArray(this.json_ld["@context"])) {
            if (this.defaults.standardContexts[contextUrl]) {
                cont = this.defaults.standardContexts[contextUrl]["@context"];
            } else if (_.isString(contextUrl)) {
                try {
                    const response = await axios.get(contextUrl,{headers: {
                        'accept': "application/ld+json, application/ld+json, text/text" 
                        } });
                    cont = response.data["@context"];
                    } 
                catch (error) {
                    console.error(error);                
                }
            } else {
                cont = contextUrl;
            }
            // Put all the keys into a flat lookup TODO: handele indirection
            for (let k of Object.keys(cont)) {
                const v = cont[k];
                if (v && v["@id"]) {
                    this.context[k] = v["@id"];
                } else {
                    this.context[k] = v;
                }

            }
        }
    }

    __addToContextLookup(cont) {
        for (let k of Object.keys(cont)) {
            const v = cont[k];
            if (v && v["@id"]) {
                this.context[k] = v["@id"];
            } else {
                this.context[k] = v;
            }
        }
    }

    addContext(cont) {
        if (!Array.isArray(this.json_ld["@context"])) {
            this.json_ld["@context"] = [this.json_ld["@context"]];
        }
        this.json_ld["@context"].push(cont);
        this.__addToContextLookup(cont)
    }

    resolveTerm(term) {
        term = term.replace(/^schema:/, ""); //schema is the default namespace
        const val =  this.context[term];
        if (val && val.match(/^http(s?):\/\//i)) {
            return val;
        } else if (val && val.match(/(.*?):(.*)/)) {
           const parts = val.match(/(.*?):(.*)/);
           const urlPart = this.context[parts[1]];
           if (urlPart && urlPart.match(/^http(s?):\/\//i)) {
                return `${urlPart}${parts[2]}`;
            }
         }
         return null;
    }

    getDefinition(term) {
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
        const val =  this.context[term];
        if (val && val.match(/^http(s?):\/\//i)) {
            def["@id"] = val;
        } else if (val && val.match(/(.*?):(.*)/)) {
           const parts = val.match(/(.*?):(.*)/);
           const urlPart = this.context[parts[1]];
           if (urlPart && urlPart.match(/^http(s?):\/\//i)) {
                def["@id"] =  `${urlPart}${parts[2]}`;
            }
         } 
         if (def["@id"] && this.getItem(def["@id"])) {
             var localDef = this.getItem(def["@id"]);
             if (localDef.sameAs && localDef.sameAs["@id"]) {
                 // There's a same-as - so use its ID
                 def["@id"] = localDef.sameAs["@id"];
                 localDef = this.getItem(def["@id"]);
             }
             if (localDef && (this.hasType(localDef, "rdfs:Class") || this.hasType(localDef,"rdf:Property") )) {
                def = localDef;
             }
         }

         return def;

    }
}



module.exports = ROCrate;