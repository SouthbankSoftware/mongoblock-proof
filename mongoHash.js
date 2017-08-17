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


let hashClient; // Tierion client
const debug = true;


const options = commandLineOptions();
let hash;

const db0 = MongoClient.connect('mongodb://' + options.uri);

//
// Connect to tierion
//
const authToken = setupTierion(options.tierionUser, options.tierionPassword);

console.log(db0, authToken);
//
// Demo loop to create a hash, store in in db, then check the hash.
//
const query = options.query;
const projection = options.projection;

Promise.all([db0, authToken]).then((params) => {
    const db = params[0];
    // const token = params[1];
    // if (debug) console.log(token);
    init(db); // This only needs to be called once
    hash = genHash(db, options.collection, query, projection);
    hash.then((h) => {
        console.log('options=' + JSON.stringify(options));
        console.log('hash=' + h);
        saveHashDb(db, db.databaseName, options.collection, h,
            query, projection).then((o) => {
            console.log('insert result=' + JSON.stringify(o.result));
            saveHashBlockChain(db, h).then((res) => {
                console.log('receipt', res);
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

function setupTierion(username, password) {
    hashClient = new Hashclient();
    returnValue = new Promise((resolve, reject) => {
        if (debug) {
            console.log('Setting up Tierion with ');
            console.log(username);
            console.log(password);
        }
        hashClient.authenticate(username, password, (err, myToken) => {
            if (err) {
                // handle the error
                reject(err);
            } else {
                // authentication was successful
                // access_token, refresh_token are returned in authToken
                // authToken values are saved internally and managed autmatically for the life of the HashClient
                console.log('Authentiation success');
                console.log(myToken);
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
    mydb = db.db('mongoblock-proof');
    mydb.collection('query_hashes').createIndex({
        'db': 1,
        'collection': 1,
        'query': 1,
        'projection': 1
    }, {
        unique: true
    });
}
//
// Create a hash from a collection query
//
function genHash(db, collection, query, projection) {
    console.log('Generating hash');
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
                    resolve(shasum.digest('hex'));
                } else {
                    reject(err);
                }
            }
        );
    });
    return (hash);
}

function saveHashBlockChain(db, hash) {
    if (debug) console.log('registering hash in blockchain ', hash);
    blockchainReceipt = new Promise((resolve, reject) => {
        hashClient.submitHashItem(hash, (err, receiptid) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                console.log('receipt id', receiptid);
                console.log('Waiting for confirmation');
                setTimeout(() => {
                    hashClient.getReceipt(receiptid.receiptId, (err2, result) => {
                        if (err2) {
                            console.log(err2);
                            reject(err2);
                        } else {
                            console.log(result);
                            console.log('Updating database with receipt');
                            updateDbRecord(db, hash, result.receipt).then(() => {
                                resolve(result.receipt);
                            });
                        }
                    });
                }, 600000);
            }
        });
    });
    return (blockchainReceipt);
}

// Update the control table with the blockchain receipt
function updateDbRecord(db, hash, receipt) {
    console.log('updateDbRecord');
    mydb = db.db('mongoblock-proof');

    console.log(filterData);
    updatedObject = new Promise((resolve, reject) => {
        mydb.collection('query_hashes').update({
                hash
            }, {
                $set: {
                    status: 'acknowledged',
                    receipt
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
    return (upDatedObject);
}
//
// Insert a hash into the control table
//
function saveHashDb(db, dbName, collection, hash, query, projection) {
    console.log('SaveHash');
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
function checkHash(db, dbName, collection, query, projection) {
    const mydb = db.db('mongoblock-proof');
    const mycollection = mydb.collection('query_hashes');

    filterData = {
        db: dbName,
        collection,
        query,
        projection
    };

    mycollection.find().forEach((doc) => {

    });
    returnValue = new Promise((resolve, reject) => {
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
                        resolve(true);
                    }
                });
            });
        });
    });
    return (returnValue);
}



function commandLineOptions() {
    const usage = 'Usage: -u MongoURI -c collectionName -q query [-p projection] -U tierionUsername -P tierionPassword';
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
    }]);
    if (!(('uri' in options) && ('query' in options) && ('collection' in options) && ('tierionUser' in options))) {
        console.log(usage);
        process.exit();
    }
    return options;
}