/* 

This is part of ro-crate-html-js a tool for generating HTMl 
previews of HTML files.

Copyright (C) 2021  University of Technology Sydney
Copyright (C) 2022  Queensland University

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

/**
 * @typedef {import('./rocrate').ROCrate} ROCrate
 */

const defaults = require('./defaults');
const { Utils } = require('./utils');
const { ROCrate } = require('./rocrate');
require('cross-fetch/polyfill');

// errors, warnings, info

function isValidUrl(urlStr) {
  try {
    let url = new URL(urlStr);
    return true;
  } catch (e) {}
  return false;
}

class Validator {
  /**
   *
   * @param {ROCrate} crate
   */
  constructor() {
    this.result = {
      errors: [],
      warnings: [],
      info: [],
    };
    this.json = null;
    this.crate = null;
  }

  parseJSON(json) {
    this.isJSON(json);
    this.isCrate();
  }

  isJSON(json) {
    /*
  
    The RO-Crate Metadata Document MUST contain RO-Crate JSON-LD; a valid [JSON-LD 1.0] document in [flattened] and [compacted] form
    The RO-Crate JSON-LD SHOULD use the RO-Crate JSON-LD Context https://w3id.org/ro/crate/1.2-DRAFT/context by reference.
    JSON-LD is a structured form of [JSON] that can represent a Linked Data graph.

    A valid RO-Crate JSON-LD graph MUST describe:

    The RO-Crate Metadata Descriptor
    The Root Data Entity
    Zero or more Data Entities
    Zero or more Contextual Entities
    */

    if (typeof json === 'object') {
      this.json = json;
      return;
    }
    try {
      this.json = JSON.parse(json);
    } catch (error) {
      this.result.errors.push({
        message: 'Crate is not JSON: ' + error,
      });
      return;
    }
    var okSoFar = true;
    const graph = this.json['@graph'];
    if (!graph) {
      this.result.errors.push({
        message: 'JSON Object does not have a @graph',
        clause:
          'The RO-Crate Metadata Document MUST contain RO-Crate JSON-LD; a valid [JSON-LD 1.0] document in [flattened] and [compacted] form',
      });
      okSoFar = false;
    } 
      for (let key of Object.keys(this.json)) {
        if (!['@graph', '@context'].includes(key)) {
          this.result.errors.push({
            message: 'JSON object contains keys other than @graph and @context',
            clause:
              'The RO-Crate Metadata Document MUST contain RO-Crate JSON-LD; a valid [JSON-LD 1.0] document in [flattened] and [compacted] form',
          });
          okSoFar = false;
        }
      }
    
    if (!okSoFar) {
      this.json = null; // Don't try to parse this further as our RO-Crate library is overly permissive for this validation task
    }
  }

  isCrate() {
    if (!this.json) return;

    try {
      this.crate = new ROCrate(this.json, {array: true,link: true});
    } catch (error) {
      this.result.errors.push({
        message: 'ROCrate-js can not parse this JSON: ' + String(error),
      });
    }
  }

  // Audit the files to see whether all the files in the crate are present and list those that are on disk but NOT in the crate
  checkFiles(fileReferences, crate) {
    if(crate) {
      // Passing in a new crate
      this.crate = crate;
    }

    // First check 
    for (let entity of this.crate.entities()) {
      if (entity["@type"].includes("File") || entity["@type"].includes("Dataset")) {
        if (!fileReferences?.[entity["@id"]]) {
          fileReferences[entity["@id"]] = {
            exists: false,
            inCrate: true
          }

          if (!isValidUrl(entity["@id"])) {
            this.result.warnings.push({
              entity: entity["@id"],
              message: `Data Entity in crate is not included in the crate directory`
            })
          } 
        }
        
      }
    }

    for (let file of Object.keys(fileReferences)) {
      // If we don't know the status of parent directory lets say is is not described
      fileReferences[file].dirDescribed = fileReferences[file].dirDescribed || false;
      // TODO -- check that type (File or Dir) of entity corresponds with the type of the thing on 

      if (!this.crate.getEntity(file)) {
        this.result.info.push({
          entity: file,
          message: `Path in crate directory does not have a corresponding Data Entity in the crate`
        })
        fileReferences[file].inCrate = false
      } else {
        fileReferences[file].inCrate = true
        if (fileReferences[file].isDir) {
          // TODO Check type

          // This directory has an entry in the crate, so mark all its descendents as being described
          for (let f of Object.keys(fileReferences)) {
            if (f.startsWith(file)) {
              fileReferences[f].dirDescribed = true;
            }
          }
        } else {
          // TODO Check type

        }
      }
    }

    
    for (let entity of this.crate.entities()) {
      if (entity["@type"].includes("File") || entity["@type"].includes("Dataset")) {
        if (!fileReferences?.[entity["@id"]]) {
          fileReferences[entity["@id"]] = {
            exists: false,
            inCrate: true
          }
          if (!isValidUrl(entity["@id"])) {
            this.result.warnings.push({
              entity: entity["@id"],
              message: `Data Entity in crate is not included in the crate directory`
            })
          }
        }
        
      }
      
    }

  }

  async hasContext() {
    if (!this.json || !this.crate) return;

    // See if there is a URL in the context which has an appropriate name
    var foundContext = false;
    for (let contextUrl of Utils.asArray(this.crate['@context'])) {
      if (typeof contextUrl === 'string' || contextUrl instanceof String) {
        try {
          const response = await fetch(/**@type {string}*/ (contextUrl), {
            headers: {
              accept: 'application/ld+json, application/ld+json, text/text',
            },
          });
          if (response.ok) {
            const content = await response.json();
            if (
              Utils.asArray(content.name).includes('RO-Crate JSON-LD Context')
            ) {
              this.result.info.push({
                message: `Has a context ${contextUrl} named "RO-Crate JSON-LD Context", version ${content.version}`,
              });
              foundContext = true;
              break;
            }
          } else {
            throw new Error(response.statusText);
          }
        } catch (error) {
          console.error(error);
          this.result.warnings.push({
            message: `There was an issue fetching this context: ${contextUrl} ${error}`,
          });
          break;
        }
      }
    }
    if (!foundContext) {
      this.result.warnings.push({
        message: "There is no reference to an 'official' RO-Crate @context",
      });
    }
  }

  rootDataEntity() {
    /* 
    The Root Data Entity MUST have the following properties: ["@type", "@id", "name", "description", "datePublished", "license"]

    @type: MUST be [Dataset] or an array that contain Dataset
    @id: SHOULD be the string ./ or an absolute URI 
    */

    if (!this.json || !this.crate) return;

    const root = this.crate.rootDataset;
    if (!root) {
      this.result.errors.push({
        entity: '',
        property: '',
        message: 'There is no Root Data Entity',
        clause: '',
      });
    } else {
      // Check ID is up to scratch -- warn if not
      if (!(root?.['@id'] === './') || isValidUrl(root?.['@id'])) {
        this.result.warnings.push({
          entity: root?.['@id'],
          message: `Root Data Entity has appropriate @id. Is: ${root?.['@id']}`,
          clause: `@id: SHOULD be the string ./ or an absolute URI `,
        });
      }
      // Check type is there -- error if not
      if (
        !(
          root?.['@type'].includes('Dataset') &&
          this.crate.resolveTerm('Dataset') === 'http://schema.org/Dataset'
        )
      ) {
        this.result.errors.push({
          entity: root['@id'],
          message: 'Root dataset does not have Dataset as one of its types',
          clause: `@type: MUST be [Dataset] or an array that contain Dataset`,
        });
      }
      // Check all the props are there - error if not
      for (let prop of [
        '@type',
        '@id',
        'name',
        'description',
        'datePublished',
        'license',
      ]) {
        if (
          !root?.[prop] ||
          (!['@type', '@id'].includes(prop) &&
            this.crate.resolveTerm(prop) != `http://schema.org/${prop}`)
        ) {
          this.result.errors.push({
            entity: root['@id'],
            message: `Missing required property: ${prop}`,
            clause: `The Root Data Entity MUST have the following properties: ["@type", "@id", "name", "description", "datePublished", "license"]`,
          });
        }
      }
      // Check the date
      if (root?.datePublished && root.datePublished.length > 1) {
        this.result.errors.push({
          entity: root['@id'],
          message: `datePublished must be a string, but multiple values have been supplied: ${root.datePublished} `,
          clause: `datePublished: MUST be a string in [ISO 8601 date format][DateTime] and SHOULD be specified to at least the precision of a day, MAY be a timestamp down to the millisecond.`,
        });
      }
    }

    if (
      root?.datePublished &&
      !root.datePublished[0].match(/^\d{4}-?([0]\d|1[0-2])?-?([0-2]\d|3[01])?/)
    ) {
      this.result.errors.push({
        entity: root['@id'],
        message: `datePublished does not start with a compliant date in this format:  YYYY, YYYY-MM or YYYY-MM-DD`,
        clause: `datePublished: MUST be a string in [ISO 8601 date format][DateTime] and SHOULD be specified to at least the precision of a day, MAY be a timestamp down to the millisecond.`,
      });
    }
  }

  async validate() {
    await this.hasContext();
    this.rootDataEntity();
    return true;
  }
}

module.exports = { Validator };
