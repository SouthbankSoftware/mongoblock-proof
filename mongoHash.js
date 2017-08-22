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

const restClient = new Restclient();
const chainpointValidate = new Chainpointvalidate();

let hashClient; // Tierion client
let debug = false;


const options = commandLineOptions();
if (options.debug) debug = true;
debuglog('options=' + JSON.stringify(options));
let hash;

// Connect to MOngoDB
const db0 = MongoClient.connect('mongodb://' + options.uri);

//
// Connect to tierion
//
const authToken = setupTierion(options.tierionUser, options.tierionPassword);
//
// Demo loop to create a hash, store in in db, then check the hash.
//
const query = options.query;
const projection = options.projection;

if (options.ValidateAll) {
    // Validate the existing hashes
    Promise.all([db0, authToken]).then((params) => { // Wait for connection promises
        const db = params[0];
        checkHash(db).then(() => {
            log('Checked all hashes');
            process.exit(0);
        });
    });
} else {
    // Generate a new hash and store it on the block chain
    Promise.all([db0, authToken]).then((params) => { // Wait for connection promises
        const db = params[0];
        const token = params[1];
        debuglog(token);
        init(db); // This only needs to be called once
        hash = genHash(db, options.collection, query, projection);
        hash.then((h) => {
            log('hash=' + h);
            saveHashDb(db, db.databaseName, options.collection, h,
                query, projection).then((o) => {
                debuglog('insert result=' + JSON.stringify(o.result));
                saveHashBlockChain(db, h).then((res) => {
                    debuglog('receipt', res);
                    checkHash(db, db.databaseName, options.collection,
                        query, projection).then(() => {
                        process.exit(0);
                    });
                });
            });
        });
    }).catch((err) => {
        log(err);
        process.exit(1);
    });
}

function log(logentry) {
    const datetime = new Date();
    console.log(datetime, logentry);
}

function debuglog(string) {
    if (debug) {
        const datetime = new Date();
        console.log(datetime + ' DEBUG: ' + string);
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
                // authentication was successful
                // access_token, refresh_token are returned in authToken
                // authToken values are saved internally and managed autmatically for the life of the HashClient
                log('Authentiation success');
                debuglog(myToken);
                resolve(myToken);
            }
        });
    });
    return (returnValue);
}
//
// This just needs to be called once to setup unique index
//
function init(db) {
    log('Checking DB tables');
    mydb = db.db('mongoblock-proof');
    mydb.collection('query_hashes').createIndex({
        'db': 1,
        'collection': 1,
        'query': 1,
        'projection': 1
    }, {
        unique: true
    });
    mydb.collection('query_hashes').createIndex({
        'hash': 1
    }, {
        unique: true
    });
}
//
// Create a hash from a supplied query
//
function genHash(db, collection, query, projection) {
    log('Generating hash ');
    //    debuglog(db);
    const algo = 'sha256';
    const shasum = crypto.createHash(algo);

    const cursor = db.collection(collection).find(JSON.parse(query));
    if (projection !== 'undefined') {
        cursor.project(JSON.parse(projection));
    }
    hash = new Promise((resolve, reject) => {
        cursor.forEach(
            (doc) => {
                shasum.update(JSON.stringify(doc));
            },
            (err) => {
                if (err === null) {
                    const thisHash = shasum.digest('hex');
                    log('hash= ' + thisHash);
                    resolve(thisHash);
                } else {
                    reject(err);
                }
            }
        );
    });
    return (hash);
}

//
// Save the hash to the blockchain using Tierion
//
function saveHashBlockChain(db, hash) {
    log('registering hash in blockchain ');
    blockchainReceipt = new Promise((resolve, reject) => {
        hashClient.submitHashItem(hash, (err, receiptid) => {
            if (err) {
                log(err);
                reject(err);
            } else {
                log('receipt id', receiptid);
                log('Waiting for confirmation');
                const myTimer = setInterval(() => {
                    log('checking... ');
                    hashClient.getReceipt(receiptid.receiptId, (err2, result) => {
                        if (err2) {
                            log(err2);
                        } else {
                            log('Tierion returns', result);
                            updateDbRecord(db, hash, result.receipt).then(() => {
                                clearInterval(myTimer);
                                resolve(result.receipt);
                            });
                        }
                    });
                }, 30000);
            }
        });
    });
    return (blockchainReceipt);
}

// Update the control table with the blockchain receipt
function updateDbRecord(db, hash, receipt) {
    log('Updating DB with receipt');
    mydb = db.db('mongoblock-proof');

    log(filterData);
    updatedObject = new Promise((resolve, reject) => {
        mydb.collection('query_hashes').update({
                hash
            }, {
                $set: {
                    status: 'acknowledged',
                    dateTime: new Date(),
                    receipt: JSON.parse(receipt)
                }
            },
            (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
    });
    return (updatedObject);
}
//
// Insert a hash into the control table
//
function saveHashDb(db, dbName, collection, hash, query, projection) {
    log('Writing hash to database ');
    mydb = db.db('mongoblock-proof');

    hashData = {
        hash,
        status: 'pending',
        dateTime: new Date()
    };
    filterData = {
        db: dbName,
        collection,
        query,
        projection
    };
    log(filterData);
    insertedObject = new Promise((resolve, reject) => {
        mydb.collection('query_hashes').update(filterData, {
            $set: hashData
        }, {
            upsert: true
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
    return (insertedObject);
}

//
// See if the hash in the control table still matches the query parameters
//
// function checkAllHash(db) {
//     log('Validating Hash');
//     const mydb = db.db('mongoblock-proof');
//     const mycollection = mydb.collection('query_hashes');

//     returnValue = new Promise((resolve) => {
//         const data = mycollection.find({}).toArray();
//         data.then((docarray) => {
//             docarray.forEach((doc) => {
//                 log('checking hash for ', doc);
//                 oldHash = doc.hash;
//                 genHash(db.db(doc.db), doc.collection, doc.query, doc.projection).then((newHash) => {
//                     if (newHash !== oldHash) {
//                         log('Hash has changed');
//                         log('old hash=' + oldHash);
//                         log('new Hash=' + newHash);
//                         resolve(false);
//                     } else {
//                         log('Hash has not changed');
//                         validateHash(doc.receipt).then((validation) => {
//                             debuglog(validation);
//                             log('Blockchain entry is at ', Date(validation));
//                             log('Hash on database document is at ', doc.dateTime);
//                             log(typeof Date(validation), typeof doc.dateTime);
//                             resolve(true);
//                         });
//                     }
//                 });
//             });
//         });
//     });
//     return (returnValue);
// }

// TODO: Modularize the two functions

//
// See if the hash in the control table still matches the query parameters
//
function checkHash(db, dbName, collection, query, projection) {
    log('Validating Hash');
    const mydb = db.db('mongoblock-proof');
    const mycollection = mydb.collection('query_hashes');
    if (dbName) {
        filterData = {
            db: dbName,
            collection,
            query,
            projection
        };
    } else {
        filterData = {};
    }

    returnValue = new Promise((resolve) => {
        const data = mycollection.find(filterData).toArray();
        data.then((docarray) => {
            docarray.forEach((doc) => {
                debuglog('got back: ', doc);
                oldHash = doc.hash;
                genHash(db, doc.collection, doc.query, doc.projection).then((newHash) => {
                    if (newHash !== oldHash) {
                        log('Hash has changed');
                        log('old hash=' + oldHash);
                        log('new Hash=' + newHash);
                        resolve(false);
                    } else {
                        log('Hash has not changed');
                        validateHash(doc.receipt).then((validation) => {
                            debuglog(validation);
                            const validationDate = new Date(validation);
                            log('Blockchain entry is at ', validation);
                            log('this is ' + new Date(validation) + ' for you humans');
                            log('Hash on database document is  ', doc.dateTime);
                            const timeDiff = (validationDate.getTime() - doc.dateTime.getTime()) / 1000;
                            log('Difference between timestamps :' + timeDiff + ' seconds');
                            if (Math.abs(timeDiff) < 20 * 60) { // Our tolerance is 20 minutes
                                resolve(true);
                            } else {
                                log('ERROR: Timetamp gap is too high');
                                resolve(false);
                            }
                        });
                    }
                });
            });
        });
    });
    return (returnValue);
}

// Check that a receipt stored in the database is in the blockchain
function validateHash(receipt) {
    log('Checking hash receipt on the blockchain');
    debuglog(receipt);
    const returnValue = new Promise((resolve, reject) => {
        chainpointValidate.isValidReceipt(receipt, true, (err, result) => {
            if (err) {
                reject(err);
            } else if (result.isValid === true) {
                log('Reciept is valid');
                const txId = receipt.anchors[0].sourceId;

                log('See "https://blockchain.info/tx/' + receipt.anchors[0].sourceId);
                log('For blockchain transaction details');
                log('Looking up blockchain transaction');
                // TODO: Should lookup blockchain transaction and check timestamps align
                lookupTxn(txId).then((txnResult) => {
                    debuglog(txnResult);
                    if ('time' in txnResult) {
                        resolve(txnResult.time * 1000);
                    } else {
                        reject(txnResult);
                    }
                });
            } else {
                reject(result);
            }
        });
    });
    return (returnValue);
}

function lookupTxn(transactionId) {
    const txRest = 'https://blockchain.info/rawtx/' + transactionId;
    const result = new Promise((resolve) => {
        restClient.get(txRest, (data, response) => {
            // parsed response body as js object
            // raw response
            debuglog(response);
            debuglog('*', data, '**');
            resolve(data);
        });
    });
    return (result);
}


function commandLineOptions() {
    const usage = 'Usage: -u MongoURI -c collectionName -q query [-p projection] -U tierionUsername -P tierionPassword [-V] [-D]';
    const options = commandLineArgs([{
            name: 'uri',
            alias: 'u',
            type: String
        }, {
            name: 'collection',
            alias: 'c',
            type: String
        }, {
            name: 'query',
            alias: 'q',
            type: String
        }, {
            name: 'projection',
            alias: 'p',
            type: String
        }, {
            name: 'tierionUser',
            alias: 'U',
            type: String
        }, {
            name: 'tierionPassword',
            alias: 'P',
            type: String
        }, {
            name: 'debug',
            alias: 'd',
            type: Boolean
        },
        {
            name: 'ValidateAll',
            alias: 'V',
            type: Boolean
        }
    ]);
    if (!(('ValidateAll' in options) || (('uri' in options) && ('query' in options) && ('collection' in options) && ('tierionUser' in options)))) {
        log(usage);
        process.exit();
    }
    return options;
}
