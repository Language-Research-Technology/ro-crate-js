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
 * @typedef {import('./rocrate')} ROCrate
 */


const defaults = require('./defaults');
const utils = require('./utils');
const axios = require('axios');

function includesTextCI(arr, texts) {
  // string entries in which one of it must exist in the array, eg ['a','b']
  const vals = utils.asArray(texts).map(t => t.toLowerCase());
  // check if arr contains any of entries in text
  // for example arr ['a', 'c', 'd'] includes 'a' which exists in ['a','b'], so return true
  return utils.asArray(arr).some(e => vals.includes(e.toLowerCase()));
}

class Checker {

  /**
   * 
   * @param {ROCrate} crate 
   */
  constructor(crate) {
    this.crate = crate;
    this.checklist = [];
  }


  async hasContext() {
    var checkItem = new CheckItem({
      name: 'Has @context',
      message: 'Has an appropriate context with a name and version'
    });

    // See if there is a URL in the context which has an appropriate name
    for (let contextUrl of utils.asArray(this.crate['@context'])) {
      if (typeof contextUrl === 'string' || contextUrl instanceof String) {
        try {
          const response = await axios.get(contextUrl, {
            headers: {
              'accept': 'application/ld+json, application/ld+json, text/text'
            }
          });
          const cont = response.data;
          if (this.crate.utils.asArray(cont.name).includes('RO-Crate JSON-LD Context')) {
            checkItem.status = true;
            checkItem.message = `Has a context named "RO-Crate JSON-LD Context", version ${cont.version}`;

          }
        } catch (error) {
          checkItem.message = error + contextUrl;
          console.error(error);
        }
      }
    }
    // TODO - fix this when we have a final release

    return checkItem;
  }

  hasRootDataset() {
    return new CheckItem({
      name: 'Has root Dataset',
      message: 'There is a JSON-LD item with @type of Dataset (http://schema.org/dataset)',
      status: !!this.crate.rootDataset
    });
  }

  hasRootDatasetWithProperID() {
    const root = this.crate.rootDataset;
    return new CheckItem({
      name: 'Root dataset has appropriate @id',
      message: `The root dataset @id ends in "/"`,
      status: !!(root && root['@id'].endsWith('/'))
    });
  }

  hasName() {
    const root = this.crate.rootDataset;
    return new CheckItem({
      name: 'Has name',
      message: 'The root Dataset has a name (http://schema.org/name)',
      status: !!(root && root.name && root.name.length > 0)
    });
  }

  hasDescription() {
    const root = this.crate.rootDataset;
    return new CheckItem({
      name: 'Has description',
      message: 'The root Dataset has a description (http://schema.org/description)',
      status: !!(root && root.description && root.description.length > 0)
    });
  }

  hasAuthor() {
    const root = this.crate.rootDataset;
    const authors = utils.asArray(root?.author).map(a => this.crate.getEntity(a['@id']));
    return new CheckItem({
      name: 'Has valid Authors',
      message: 'The root Dataset has at least one Author (http://schema.org/author) referred to by @id, and all authors have @type Person (http://schema.org/Person) or Organization (http://schema.org/Organization)',
      status: (authors.length > 0) && authors.every(a => includesTextCI(a?.['@type'], ['Person', 'Organization']))
    });
  }

  hasLicense() {
    const root = this.crate.rootDataset;
    const licenses = utils.asArray(root?.license).map(l => this.crate.getEntity(l['@id']));
    return new CheckItem({
      name: 'Has a license ',
      message: 'The root Dataset has a License' + 
        licenses.map(license => license && license.name && license.description && 
          includesTextCI(license['@type'], 'CreativeWork') ? 
          ' (the license is a Creative Work with a name and description as it SHOULD be)' : ''
          ).join(''),
      status: (licenses.length > 0)
    });
  }

  hasDatePublished() {
    const root = this.crate.rootDataset;
    var date = utils.asArray(root?.datePublished);
    return new CheckItem({
      name: 'Has a datePublished ',
      message: 'The root Dataset has a datePublished with ONE value which is an  ISO 8601 format  precision of at least a day',
      diagnostics: date.length === 1 ? '' : `Number of datePublished values is ${date.length} NOT 1`,
      status: !!(date.length === 1 && date[0]?.match(/^\d{4}-([0]\d|1[0-2])-([0-2]\d|3[01])/))
    });
  }


  hasContactPoint() {
    const root = this.crate.rootDataset;
    var contacts = utils.asArray(root?.contactPoint).map(c => this.crate.getEntity(c['@id']));
    return new CheckItem({
      name: 'Has a contactPoint',
      message: 'The root Dataset has at least one contactPoint property which references a ContactPoint of type Customer Service',
      status: contacts.some(contact => contact && contact.email && 
        utils.asArray(contact['@type']).includes('ContactPoint') &&
        utils.asArray(contact.contactType).includes('customer service'))
    });
  }

  async check() {
    var checkNames = methods.filter(n => !(n in {hasContext:0,hasAuthor:0,hasContactPoint:0}))
    var context = await this.hasContext();
    this.checklist = [context].concat(checkNames.map(n => this[n]()));
    this.isROCrate = this.checklist.every(c => c.status);

    // TODO: 
    // this.isDistributable


    // this.isCitable
  }

  summarize() {
    return this.isROCrate ? 'This is a valid RO-Crate' : 'This is not a valid RO-Crate';
  }

  report() {
    var report = [];
    for (var item of this.checklist) {
      const tick = item.status ? '✔️' : '❌';
      report.push(`${tick}   ${item.name}: ${item.message}`);
    }
    return report.join('\n');
  }

  async validate() {
    await this.check();
    const summary = this.summarize();
    const report = this.report();
    return `${summary}\n${report}`;
  }

}

const methods = Object.getOwnPropertyNames(Checker.prototype).filter(n => n.startsWith('has'));

class CheckItem {
  constructor(data) {
    this.name = data.name;
    this.message = data.message;
    this.status = data.status ?? false;
    if (data.diagnostics) this.diagnostics = data.diagnostics;
  }
}

module.exports = Checker;
