/*
 *
 * This is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * this is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this.  If not, see <http://www.gnu.org/licenses/>.
 */
/**
 * Created by guy@southbanksoftware.com on 5/8/2017
 */

const crypto = require('crypto');
const MongoClient = require('mongodb').MongoClient;
const commandLineArgs = require('command-line-args');
const Hashclient = require('hashapi-lib-node');
const Chainpointvalidate = require('chainpoint-validate');
const Restclient = require('node-rest-client').Client;
const stringify = require('json-stringify-safe');

const restClient = new Restclient();
const chainpointValidate = new Chainpointvalidate();

let hashClient; // Tierion client
let debug = false;


let hash;
let receiptid='5b3bea681ab3ae29b7a753a8';
//
// Connect to tierion
//
const authToken = setupTierion('guy.harrison@outlook.com', 'DBEnvy2016');

log('receipt id', receiptid);
log('Waiting for confirmation');
let myTimer = setInterval(() => {
  log('checking... ');
  hashClient.getReceipt(receiptid, (err2, result) => {
    if (err2) {
      log(err2);
    } else {
      log('Tierion returns', result);
        clearInterval(myTimer);
        log(result.receipt);
    }
  });
}, 3000);
//
// Demo loop to create a hash, store in in db, then check the hash.
//


function log(...logentry) {
    const datetime = new Date();
    let outlog = datetime;
    if (Array.isArray(logentry)) {
      logentry.forEach((le) => {
        if (le.constructor == String) {
          outlog += ' ' + le;
        } else {
          outlog += ' ' + JSON.stringify(le);
        }
      });
    }
    console.log(outlog);
  }

function debuglog(...logentry) {
  if (debug) {
    log('DEBUG', logentry);
  }
}

function setupTierion(username, password) {
  log('Authenticating with Tierion');
  hashClient = new Hashclient();
  returnValue = new Promise((resolve, reject) => {
    hashClient.authenticate(username, password, (err, myToken) => {
      if (err) {
        // handle the error
        log(err);
        reject(err);
      } else {
        // authentication was successful access_token, refresh_token are returned in
        // authToken authToken values are saved internally and managed autmatically for
        // the life of the HashClient
        log('Authentiation success');
        debuglog(myToken);
        resolve(myToken);
      }
    });
  });
  return (returnValue);
}

