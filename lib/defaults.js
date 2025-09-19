/* This is part of Calcyte a tool for implementing the RO-Crate data packaging
spec.  Copyright (C) 2018  University of Technology Sydney

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

/* Defaults for Calcyte such as names of key files */


const back_links = {};

const roCrateMetadataID = "ro-crate-metadata.json";
const roCrateVersion = "1.2";
const roCrateSpecUrl = "https://w3id.org/ro/crate/" + roCrateVersion;
const roCrateContextUrl = roCrateSpecUrl + "/context";

const DATASET_TEMPLATE = {
  "@type": "Dataset",
  "@id": "./",
};

const METADATA_FILE_DESCRIPTOR = {
  "@type": "CreativeWork",
  "@id": roCrateMetadataID,
  "identifier": roCrateMetadataID,
  "about": { "@id": "./" },
  "conformsTo": { "@id": roCrateSpecUrl }
};

const back_back_links = new Set(Object.values(back_links));

const defaults = {
  ro_crate_name: "ro-crate-metadata",
  roCrateMetadataID: roCrateMetadataID,
  roCrateMetadataIDs: [roCrateMetadataID, "ro-crate-metadata.jsonld"],
  roCrateContextUrl,
  context: [roCrateContextUrl, { "@vocab": "http://schema.org/" }],
  render_script: "https://data.research.uts.edu.au/examples/ro-crate/examples/src/crate.js",
  back_links: back_links,
  back_back_links: back_back_links,
  datasetTemplate: DATASET_TEMPLATE,
  metadataFileDescriptorTemplate: METADATA_FILE_DESCRIPTOR,
  ROCrate_Specification_Identifier: METADATA_FILE_DESCRIPTOR.conformsTo,
  roCratePreviewFileName: "ro-crate-preview.html",
  pageSize: 50
};

module.exports = defaults;