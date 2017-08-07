const crypto = require('crypto');
const MongoClient = require('mongodb').MongoClient;
const commandLineArgs = require('command-line-args');
const assert = require('assert');


const options = commandLineOptions();
let hash;

const db0 = MongoClient.connect('mongodb://' + options.uri);

db0.then((db) => {
    init(db); // This only needs to becalled once
    hash = genHash(db, options.collection, options.query, options.projection);
    hash.then((h) => {
        console.log('options='+JSON.stringify(options));
        console.log('hash='+h);
        saveHash(db, db.databaseName, options.collection, h,
            options.query, options.projection).then((o) => {
            console.log('insert result='+JSON.stringify(o.result));
            checkHash(db, db.databaseName, options.collection, h,
                options.query, options.projection);
        });


    });
});
//
// This just needs to be called once to setup unique index 
//
function init(db) {
    mydb = db.db("mongoblock-proof");
    mydb.collection("query_hashes").createIndex({
        "db": 1,
        "collection": 1,
        "query": 1,
        "projection": 1
    }, {
        unique: true
    });
}
//
// Create a hash from a collection query
// NB: Need enough memory to hold the entire result set
//
function genHash(db, collection, query, projection) {
    const algo = 'sha256';
    const shasum = crypto.createHash(algo);

    var cursor = db.collection(collection).find(JSON.parse(query));
    if (projection !== 'undefined') {
        cursor.project(JSON.parse(projection));
    }
    hash = new Promise((resolve, reject) => {
        cursor.forEach(
            function (doc) {
                shasum.update(JSON.stringify(doc));
            },
            function (err) {
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
    //console.log('SaveHash');
    mydb = db.db("mongoblock-proof");
    hashData = {
        hash: hash,
        status: 'pending',
        dateTime: new Date()
    };
    filterData = {
        db: dbName,
        collection: collection,
        query: query,
        projection: projection
    };
    console.log(filterData);
    insertedObject = new Promise((resolve, reject) => {
        mydb.collection("query_hashes").update(filterData, {
            $set: hashData
        }, {
            upsert: true
        }, function (err, res) {
            if (err)
                reject(err)
            else
                resolve(res);
        });
    });
    return (insertedObject);
}

function checkHash(db, dbName, collection, hash, query, projection) {
    mydb = db.db("mongoblock-proof");
    //var projection = (JSON.parse(projection));

    //var query = JSON.parse(query);
    filterData = {
        db: dbName,
        collection: collection,
        query: query,
        projection: projection
    };
    console.log('Checking hash for '+JSON.stringify(filterData));
   returnValue = new Promise((resolve, reject) => {
        var cursor = mydb.collection("query_hashes").find(filterData);
        cursor.forEach(
            function (doc) {
                oldHash = doc.hash;
                genHash(db, collection, query, projection).then((newHash) => {
                    if (newHash !== oldHash) {
                        console.log("Hash has changed");
                        console.log("old hash=" + oldHash);
                        console.log("new Hash=" + newHash);
                        resolve(false); 
                    } else {
                        console.log('Hash has not changed');
                        resolve(true); 
                    }
                });
            },
            function (err) {
                if (err)
                reject(err);
            }
        );
     });
    return(returnValue); 
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
    }, , {
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