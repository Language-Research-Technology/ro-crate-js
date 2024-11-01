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


const defaults = require('./defaults');
const {Utils} = require('./utils');
const {ROCrate} = require('./rocrate');
const _g = typeof window === 'object' ? window : (typeof global === 'object' ? global : {});
const fetch = _g.fetch || require('cross-fetch');

// errors, warnings, info

function isValidUrl(urlStr) {
  try {
    let url = new URL(urlStr);
    return true;
  } catch (e) {
  }
  return false;
}

class Validator {

  constructor(crate) {
    this.result = {
      errors: [],
      warnings: [],
      info: [],
    };
    this.results = [];
    this.crate = crate || null;
    this.json = null;
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
    } else if (typeof json === 'string') {
      try {
        this.json = JSON.parse(json);
      } catch (error) {
        this.results.push({
          id: "validJson",
          status: "error",
          message: "Crate is not JSON: " + error,
          clause: 'not a json'
        });
        return;
      }
    }
    var okSoFar = true;
    const graph = this.json['@graph'];
    if (!graph) {
      this.results.push({
        id: "validCrateNoGraph",
        status: "error",
        message: 'JSON Object does not have a @graph',
        clause: 'The RO-Crate Metadata Document MUST contain RO-Crate JSON-LD; a valid [JSON-LD 1.0] document in [flattened] and [compacted] form'
      });
      okSoFar = false;
    }
    for (let key of Object.keys(this.json)) {
      if (!['@graph', '@context'].includes(key)) {
        this.results.push({
          id: "validCrateInvalidKeys",
          status: "error",
          message: 'JSON object contains keys other than @graph and @context',
          clause: 'The RO-Crate Metadata Document MUST contain RO-Crate JSON-LD; a valid [JSON-LD 1.0] document in [flattened] and [compacted] form'
        });
        okSoFar = false;
      }
    }

    if (!okSoFar) {
      this.json = null; // Don't try to parse this further as our RO-Crate library is overly permissive for this validation task
    }
  }

  log({id, status, message, clause = null}) {
    this.results.push({
      id,
      status,
      message,
      clause
    })
  }

  isCrate() {
    if (!this.json) return;

    let id = "mustBeJson"
    let clause =
      "A JSON-LD document that describes the RO-Crate with structured data in the form of RO-Crate JSON-LD."

    try {
      this.crate = new ROCrate(this.json, {array: true, link: true});
      this.log({
        id,
        status: "success",
        message: "",
        clause
      })
    } catch (error) {
      this.log({
        id,
        status: "error",
        message: 'ROCrate-js can not parse this JSON: ' + String(error),
        clause
      });
    }
  }

  // Audit the files to see whether all the files in the crate are present and list those that are on disk but NOT in the crate
  checkFiles(fileReferences, crate) {
    if (crate) {
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
    // See if there is a URL in the context which has an appropriate name
    var foundContext = false;
    let id = "contextName"
    let clause = "The conformsTo of the RO-Crate Metadata Descriptor SHOULD be a versioned permalink URI of the RO-Crate specification that the RO-Crate JSON-LD conforms to. The URI SHOULD start with https://w3id.org/ro/crate/."
    for (let contextUrl of Utils.asArray(this.crate['@context'])) {
      if (typeof contextUrl === 'string' || contextUrl instanceof String) {
        try {
          const response = await fetch(/**@type {string}*/ (contextUrl), {
            headers: {
              accept: 'application/ld+json, application/ld+json, text/text',
            },
          });
          if (response.ok) {
            const content = await response.json()
            if (
              Utils.asArray(content.name).includes('RO-Crate JSON-LD Context')
            ) {
              // TODO: potentially reports too early
              this.log(
                {
                  id, status: "success",
                  message: `Has a context ${contextUrl} named "RO-Crate JSON-LD Context", version ${content.version}`,
                  clause
                }
              )
              foundContext = true;
            }
          } else {
            throw new Error(response.statusText);
          }
        } catch (error) {
          console.error(error);
          this.log({
            id: "contextUrlNotFound",
            status: "warning",
            message: `There was an issue fetching this context: ${contextUrl} ${error}`,
            clause: "context URL should resolve"
          });
        }
      }
    }
    if (!foundContext) {
      this.log({
        id: "hasContext",
        status: "warning",
        message: "There is no reference to an 'official' RO-Crate @context",
        clause: 'Should have at least one official ro-crate context'
      });
    }
  }

  rootDataEntity() {
    /* 
    The Root Data Entity MUST have the following properties: ["@type", "@id", "name", "description", "datePublished", "license"]

    @type: MUST be [Dataset] or an array that contain Dataset
    @id: SHOULD be the string ./ or an absolute URI 
    */

    const root = this.crate.rootDataset;
    if (!root) {
      this.log({
        id: "hasRootDataEntity",
        status: "error",
        message: "There is no root data entity",
        clause: "Must have root data entity"
      })
    } else {
      // Check ID is up to scratch -- warn if not
      if (!(root?.['@id'] === './') || isValidUrl(root?.['@id'])) {
        // TODO: add ability to pass specific entity to log
        this.log({
          id: "rootDataEntityId",
          status: "warning",
          message: `Root Data Entity has appropriate @id. Is: ${root?.['@id']}`,
          clause: `@id: SHOULD be the string ./ or an absolute URI `
        })
      }
      // Check type is there -- error if not
      if (
        !(
          root?.['@type'].includes('Dataset') &&
          this.crate.resolveTerm('Dataset') === 'http://schema.org/Dataset'
        )
      ) {
        this.log({
          id: "rootDatasetType",
          status: "error",
          message: 'Root dataset does not have Dataset as one of its types',
          clause: `@type: MUST be [Dataset] or an array that contain Dataset`
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
        let id = `${prop}Required`;
        let clause = `The Root Data Entity MUST have the following properties: ["@type", "@id", "name", "description", "datePublished", "license"]`
        if (
          !root?.[prop] ||
          (!['@type', '@id'].includes(prop) &&
            this.crate.resolveTerm(prop) != `http://schema.org/${prop}`)
        ) {
          this.log({
            id,
            status: "error",
            message: `Missing required property: ${prop}`,
            clause
          });
        } else {
          this.log({
            id,
            status: "success",
            message: `Found required property: ${prop}`,
            clause
          });
        }
      }

      let id = "datePublishedIsString";
      let clause = "datePublished: MUST be a string in [ISO 8601 date format][DateTime] and SHOULD be specified to at least the precision of a day, MAY be a timestamp down to the millisecond."
      // Check the date
      if (root?.datePublished) {
        if (root.datePublished.length > 1) {
          this.log(
            {
              id,
              status: "error",
              message: `datePublished must be a string, but multiple values have been supplied: ${root.datePublished} `,
              clause
            }
          );
        } else {
          this.log(
            {
              id,
              status: "success",
              message: "datePublished is a single string",
              clause
            }
          );
        }
      }
    }

    let id = "datePublishedFormat"
    let clause = `datePublished: MUST be a string in [ISO 8601 date format][DateTime] and SHOULD be specified to at least the precision of a day, MAY be a timestamp down to the millisecond.`
    if (root?.datePublished) {
      for(let dP of root.datePublished) {
        if (dP && !dP.match(/^\d{4}-?([0]\d|1[0-2])?-?([0-2]\d|3[01])?/)) {
          this.log(
            {
              id,
              status: "error",
              message: `datePublished does not start with a compliant date in this format:  YYYY, YYYY-MM or YYYY-MM-DD`,
              clause
            }
          );
        } else {
          this.log(
            {
              id,
              status: "success",
              message: "datePublished is in compliant format.",
              clause
            }
          );
        }
      }
    }
  }

  async validate() {
    if (!this.crate) return false;
    await this.hasContext();
    this.rootDataEntity();
    return true;
  }
}

async function validate(crate, files) {
  let validator;
  // check if crate is an instance of ROCrate class
  if (crate instanceof ROCrate) {
    validator = new Validator(crate);
  } else {
    validator = new Validator();
    validator.parseJSON(crate);
  }

  await validator.validate();
  if (files) {
    await validator.checkFiles(files);
  }
  return validator.results;
}

module.exports = { Validator, validate };
