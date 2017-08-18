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


const chainpointValidate = new Chainpointvalidate();

let hashClient; // Tierion client
let debug = false;


const options = commandLineOptions();
if (options.debug) debug = true;
if (debug) console.log('options=' + JSON.stringify(options));
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
    Promise.all([db0, authToken]).then((params) => { // Wait for connection promises
        const db = params[0];
        checkAllHash(db).then(() => {
            console.log('Checked all hashes');
            process.exit(0);
        });
    });
} else {
    Promise.all([db0, authToken]).then((params) => { // Wait for connection promises
        const db = params[0];
        const token = params[1];
        if (debug) console.log(token);
        init(db); // This only needs to be called once
        hash = genHash(db, options.collection, query, projection);
        hash.then((h) => {
            console.log('hash=' + h);
            saveHashDb(db, db.databaseName, options.collection, h,
                query, projection).then((o) => {
                if (debug) console.log('insert result=' + JSON.stringify(o.result));
                saveHashBlockChain(db, h).then((res) => {
                    if (debug) console.log('receipt', res);
                    checkHash(db, db.databaseName, options.collection,
                        query, projection).then(() => {
                        process.exit(0);
                    });
                });
            });
        });
    }).catch((err) => {
        console.log(err);
        process.exit(1);
    });
}

function setupTierion(username, password) {
    process.stdout.write('***** Authenticating with Tierion');
    hashClient = new Hashclient();
    returnValue = new Promise((resolve, reject) => {

        hashClient.authenticate(username, password, (err, myToken) => {
            if (err) {
                // handle the error
                console.log(err);
                reject(err);
            } else {
                // authentication was successful
                // access_token, refresh_token are returned in authToken
                // authToken values are saved internally and managed autmatically for the life of the HashClient
                console.log('Authentiation success');
                if (debug) console.log(myToken);
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
    console.log('***** Checking DB tables');
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
    process.stdout.write('***** Generating hash ');
    if (debug) console.log(db);
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
                    console.log(' hash= ' + thisHash);
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
    process.stdout.write('**** registering hash in blockchain ');
    blockchainReceipt = new Promise((resolve, reject) => {
        hashClient.submitHashItem(hash, (err, receiptid) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                console.log('receipt id', receiptid);
                console.log('Waiting for confirmation');
                const myTimer = setInterval(() => {
                    process.stdout.write('checking... ');
                    hashClient.getReceipt(receiptid.receiptId, (err2, result) => {
                        if (err2) {
                            console.log(err2);
                        } else {
                            console.log('Tierion returns', result);
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
    console.log('****  Updating DB with receipt');
    mydb = db.db('mongoblock-proof');

    console.log(filterData);
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
    process.stdout.write('**** Writing hash to database ');
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
    console.log(filterData);
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
function checkAllHash(db) {
    console.log('***** Validating Hash');
    const mydb = db.db('mongoblock-proof');
    const mycollection = mydb.collection('query_hashes');

    returnValue = new Promise((resolve) => {
        const data = mycollection.find({}).toArray();
        data.then((docarray) => {
            docarray.forEach((doc) => {
                console.log('checking hash for ', doc);
                oldHash = doc.hash;
                genHash(db.db(doc.db), doc.collection, doc.query, doc.projection).then((newHash) => {
                    if (newHash !== oldHash) {
                        console.log('Hash has changed');
                        console.log('old hash=' + oldHash);
                        console.log('new Hash=' + newHash);
                        resolve(false);
                    } else {
                        console.log('Hash has not changed');
                        validateHash(doc.receipt).then((validation) => {
                            if (debug) console.log(validation);
                            resolve(true);
                        });
                    }
                });
            });
        });
    });
    return (returnValue);
}
//
// See if the hash in the control table still matches the query parameters
//
function checkHash(db, dbName, collection, query, projection) {
    console.log('***** Validating Hash');
    const mydb = db.db('mongoblock-proof');
    const mycollection = mydb.collection('query_hashes');
    filterData = {
        db: dbName,
        collection,
        query,
        projection
    };

    returnValue = new Promise((resolve) => {
        const data = mycollection.find(filterData).toArray();
        data.then((docarray) => {
            docarray.forEach((doc) => {
                oldHash = doc.hash;
                genHash(db, collection, query, projection).then((newHash) => {
                    if (newHash !== oldHash) {
                        console.log('Hash has changed');
                        console.log('old hash=' + oldHash);
                        console.log('new Hash=' + newHash);
                        resolve(false);
                    } else {
                        console.log('Hash has not changed');
                        validateHash(doc.receipt).then((validation) => {
                            if (debug) console.log(validation);
                            resolve(true);
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
    console.log('***** Checking hash receipt on the blockchain');
    if (debug) console.log(receipt);
    const returnValue = new Promise((resolve, reject) => {
        chainpointValidate.isValidReceipt(receipt, true, (err, result) => {
            if (err) {
                reject(err);
            } else if (result.isValid === true) {
                console.log('***** Reciept is valid');
                console.log('***** See https://blockchain.info/tx/' + receipt.anchors[0].sourceId);
                console.log('***** For blockchain transaction details');
                // TODO: Should lookup blockchain transaction and check timestamps align
                resolve(result);
            } else {
                reject(result);
            }
        });
    });
    return (returnValue);
}

function commandLineOptions() {
    const usage = 'Usage: -u MongoURI -c collectionName -q query [-p projection] -U tierionUsername -P tierionPassword -V -D';
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
    }]);
    if (!(('uri' in options) && ('query' in options) && ('collection' in options) && ('tierionUser' in options))) {
        console.log(usage);
        process.exit();
    }
    return options;
}
