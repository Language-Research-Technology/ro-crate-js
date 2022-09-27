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
   * @param {string} prop 
   * @param {*} val 
   * @return {boolean}
   */
  static has(item, prop, val) {
    return JsonldUtils.asArray(item[prop]).some(v => this.isEqualRef(v, val));
  }

  /**
   * Normalise a value to be an array.
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
   * Return the current value if it is already an array, else return a new array
   * @param {*} value 
   * @returns {Array}
   */
   static asArrayRef(value) {
    if (value == null) {
      return [];
    } else if (Array.isArray(value)) {
      return value; 
    } else {
      return [value];
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
    let ids = new Set();
    return subgraphs.flat().filter(n => !ids.has(n['@id']) && ids.add(n['@id']));
    //return _.uniqBy(_.flatMap(subgraphs), (i) => i['@id']);
  }

  /**
   * @template T
   * @param {T} data 
   * @return {T} 
   */
  static clone(data) {
    return clone(data);
  }

  /**
   * Count the number of properties in an object
   */
  static countProp(obj) {
    let c = 0;
    for (const key in obj) {
      c++;
    }
    return c;
  }

  /**
   * Deep comparison for JSON-serializable plain object
   */
  static isEqual(a, b, equalFn) {
    return isDeepEqual(a, b, equalFn);
  }

  static isEqualRef(a, b) {
    //console.log(a, b);
    return isDeepEqual(a, b, (a, b) => a['@id'] || b['@id'] ? a['@id'] === b['@id'] : null);
  }
  
  /**
   * Find if a value (can be primitives, object, or an entity) exists in a list of values  
   * @param {*[]} values 
   * @param {*} val 
   * @returns 
   */
  static exists(values, val) {
    //return values.some(v => (val['@id'] || v['@id']) ? val['@id'] === v['@id'] : isDeepEqual(v, val));
    return values.some(v => isDeepEqual(v, val, 
      (a, b) => (a['@id'] || b['@id']) ? a['@id'] === b['@id'] : null ));
  }

  constructor() {
    // for backward compatibility
    return JsonldUtils;
  }

}

//objectEqualityMethodName
function isDeepEqual(a, b, objectEquals) {
  if (a === b) return true;
  if (Object.is(a, b)) return true;
  let ta = typeof a, tb = typeof b;
  if (ta === tb) {
    if (ta === 'function') return a.toString() === b.toString();
    if (ta === 'object' && a.constructor === b.constructor) {
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length === b.length) {
          for (let i = 0; i < a.length; ++i) {
            if (!isDeepEqual(a[i], b[i])) return false;
          }
          return true;
        }
        return false;
      }
      if (objectEquals) {
        let r = objectEquals(a, b);
        if (r != null) return r;
      }
      if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
      let props = new Set(Object.getOwnPropertyNames(a).concat(Object.getOwnPropertyNames(b)));
      for (const key of props) {
        if (!isDeepEqual(a[key], b[key], objectEquals)) return false;
      }
      let ia = a[Symbol.iterator], ib = b[Symbol.iterator]
      if (typeof ia === 'function' && typeof ib === 'function') {
        ia = ia(), ib = ib();
        if (typeof ia === 'function' && typeof ib === 'function') {
          let ra = ia.next(), rb = ib.next();
          while (ra && rb && (!ra.done || !rb.done)) {
            if (!isDeepEqual(ra.value, rb.value)) return false;
            ra = ia.next(), rb = ib.next();
          }
        }
      } else {
        return false;
      }
      return true;
    }
  }
  return false;
}

var objectProto = Object.prototype;

// ignore function
function clone(data) {
  var obj;
  if (typeof data === 'object') {
    switch (objectProto.toString.call(data)) {
      case '[object Object]':
        obj = Object.create(Object.getPrototypeOf(data));
        for (const key of Object.keys(data)) {
          obj[key] = clone(data[key]);
        }
        return obj;
      case '[object Array]':
        return data.map(clone);
      default:
        return JSON.parse(JSON.stringify(data));
    }
  }
  return data;
}

module.exports = JsonldUtils;
