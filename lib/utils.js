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
class jsonldUtils {
     constructor() { }
     /**
      * 
      * @param {*} item 
      * @param {*} type 
      * @return {boolean}
      */
     hasType(item, type) {
         return this.has(item, '@type', type);
     }

     /**
      * 
      * @param {*} item 
      * @param {*} prop 
      * @param {*} type 
      * @return {boolean}
      */
     has(item, prop, type) {
        return this.asArray(item[prop]).includes(type);
     }

     /**
      * Normalise a value to be an array 
      * @param {*} value 
      * @returns {Array}
      */
     asArray(value) {
         // 
        if (value == null) {
            return [];
        } else if (!Array.isArray(value)) {
            return [value];
        } else {
            return value;
        }
    }
    
    /**
     * 
     * @param {*} item 
     * @param {*} type 
     */
    addType(item, type) {
        // Add a type to a JSON-LD item
        this.add(item, "@type", type);
    }
    
    /**
     * Add a property to an item
     * @param {*} item 
     * @param {*} prop 
     * @param {*} value 
     */
    add(item, prop, value) {
        var values = this.asArray(item[prop]);
        if (!values.includes(value)) {
            values.push(value);
        }
        item[prop] = values.length === 1 ? values[0] : value;
    }
}

module.exports = jsonldUtils;