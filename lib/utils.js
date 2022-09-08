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

const _ = require('lodash');

/**
 * Utility functions for JSON-LD
 */
class JsonldUtils {
  /**
   * 
   * @param {object} item 
   * @param {string} type 
   * @return {boolean}
   */
  static hasType(item, type) {
    return JsonldUtils.has(item, '@type', type);
  }

  /**
   * 
   * @param {*} item 
   * @param {*} prop 
   * @param {*} type 
   * @return {boolean}
   */
  static has(item, prop, type) {
    return JsonldUtils.asArray(item[prop]).includes(type);
  }

  /**
   * Normalise a value to be an array
   * Always return a new instance of the array to maintain consistency
   * @param {*} value 
   * @returns {Array}
   */
  static asArray(value) {
    if (value == null) {
      return [];
    } else {
      return [].concat(value);
    }
  }

  /**
   * Add a type to a JSON-LD item
   * @param {*} item 
   * @param {*} type 
   */
  static addType(item, type) {
    JsonldUtils.add(item, "@type", type);
  }

  /**
   * Add a property to an item
   * @param {*} item 
   * @param {*} prop 
   * @param {*} value 
   */
  static add(item, prop, value) {
    var values = JsonldUtils.asArray(item[prop]);
    if (!values.includes(value)) {
      values.push(value);
    }
    item[prop] = values.length === 1 ? values[0] : value;
  }

  static union(...subgraphs) {
    return _.uniqBy(_.flatMap(subgraphs), (i) => i['@id']);
  }

  static clone(data) {
    return JSON.parse(JSON.stringify(data));
  }

  constructor() {
    // for backward compatibility
    return JsonldUtils;
  }

}

module.exports = JsonldUtils;
