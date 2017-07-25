const crypto = require('crypto');
const MongoClient = require('mongodb').MongoClient;
const commandLineArgs = require('command-line-args');
const assert = require('assert');


const options = commandLineOptions();
let hash;
console.log(options);

const db0 = MongoClient.connect('mongodb://' + options.uri);

db0.then((db) => {
    hash = genHash(db, options.collection, options.query);
    console.log(hash);

    hash.then((h) => {
        console.log(options);
        console.log(h);
        return (h);
    });
});


function genHash(db, collection, query) {
    const algo = 'sha256';
    const shasum = crypto.createHash(algo);
    const hash = new Promise((resolve, reject) => {
        const data = db.collection(collection).find(JSON.parse(query)).toArray();
        data.then((d) => {
            shasum.update(JSON.stringify(d));
            resolve(shasum.digest('hex'));
        }).catch((e) => {
        reject(e.stack);
      });
    });
    return (hash);
}

function commandLineOptions() {
    const usage = 'Usage: -u MongoURI -c collectionName -q query ';
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
    }]);
    if (!(('uri' in options) && ('query' in options) && ('collection' in options))) {
        console.log(usage);
        process.exit();
    }
    return options;
}
