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

const options = commandLineOptions();
let hash;

const db0 = MongoClient.connect('mongodb://' + options.uri);

//
// Demo loop to create a hash, store in in db, then check the hash. 
//
var query= options.query;
var projection= options.projection; 
 
db0.then((db) => {
    init(db); // This only needs to becalled once
    hash = genHash(db, options.collection, query, projection);
    hash.then((h) => {
        console.log('options=' + JSON.stringify(options));
        console.log('hash=' + h);
        saveHash(db, db.databaseName, options.collection, h,
            query, projection).then((o) => {
            console.log('insert result=' + JSON.stringify(o.result));
            checkHash(db, db.databaseName, options.collection,
                query, projection).then ((x)=>{
                    process.exit(0); 
                }); 
        });
    });
});

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

//
// Insert a hash into the control table
//
function saveHash(db, dbName, collection, hash, query, projection) {
    // console.log('SaveHash');
    mydb = db.db('mongoblock-proof');
    hashData = {
        hash,
        status: 'pending',
        dateTime: new Date()
    };
    filterData = {
        db: dbName,
        collection:collection,
        query:query,
        projection: projection
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
    
    var mydb = db.db('mongoblock-proof');
    var mycollection=mydb.collection('query_hashes');

    filterData = {
        db: dbName,
        collection:collection,
        query:query,
        projection: projection
    };
 
   mycollection.find().forEach((doc)=>{

   });
   returnValue = new Promise((resolve, reject) => {
        const data = mycollection.find(filterData).toArray();
        data.then ( (docarray) =>{
            docarray.forEach((doc)=>{
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
    const usage = 'Usage: -u MongoURI -c collectionName -q query [-p projection]';
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
    }]);
    if (!(('uri' in options) && ('query' in options) && ('collection' in options))) {
        console.log(usage);
        process.exit();
    }
    return options;
}
