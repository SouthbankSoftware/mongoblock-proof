# Sealing MongoDB documents on the blockchain
As human beings, we get used to the limitations of the technologies we use and over time forget how fundamental some of these limitations are. As a database administrator in the early 1990s, I remember the shock I felt when I realized that the contents of the database files were plain text; I’d just assumed they were encrypted and could only be modified by the database engine acting on behalf of a validated user.  But I got used to it. I also got used to the idea that the contents of a database where pretty much what I – the DBA – said it was.  Rudimentary audit logs could be put in place to track activity, but as DBA I could easily disable the audit logs and tamper with any database if I so desired. I think it’s obvious to all of us that this is not the way it should be – contents of production databases should be trustworthy,  We should know that a DBA, hacker or privileged user has not tampered with the contents of the database.  However, until recently we lacked the technology to ensure this.However, the emergence of a tamper-proof distributed ledger in the form of the Blockchain now promises to give us a mechanism to at least “seal” database records.  We can’t necessarily stop a hacker or malicious insider from breaking the seal, but we can at least know if the seal has been broken.  In this post, I’ll show how to implement a simple Blockchain seal for MongoDB.  We’ll record a hash value corresponding to a set of documents in a database.  As long as the hash value has not changed, we can be confident that the database records have not been tampered with.  The hash value is stored on the Blockchain to ensure that it has not been tampered with.  I’m using the Tierion service to handle the Blockchain proof of existence processing – you can apply for a free Tierion account at tierion.com. I’m going to step through just the basic steps in this post – you can find the full source code at https://github.com/SouthbankSoftware/mongoblock-proof. 

We setup a connection to Tierion using our username and password.  This returns a token which we can examine, but for our purposes it initialises the `hashClient` that we'll use in subsequent calls.

```javascript
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
                console.log('Authentiation success');
                if (debug) console.log(myToken);
                resolve(myToken);
            }
        });
    });
    return (returnValue);
}
```
We generate a hash for a set of MongoDB documents using the crypto package.  This function takes db, collection, filter and projection arguments to determine the set of documents to be returned.  A hash digest is generated for those documents.  Should anyone alter those documents then the hash will no longer be valid

```javascript
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
``` 
We store the hash into a control table in the MongoDB database itself.  That part is trivial so I won't show it here.  Then we call out to Tierion to store that hash on the blockchain.
```javascript
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
```
The sequence of events in this function is:

1. We submit the hash to Tierion using the submitHashItem call.  This gives us a receipt id. 
2. We check the status of the receiptId periodically using the getReceipt call.  It may take as long as 10 minutes to see our receipt on the block, so we poll every 30 seconds
3. Once we get the updated receipt, we store it into the database record. 

If we want to see that the database documents have not been tampered with, we call the checkHash function, using the query filters that we originally used to create the hash in the first place.  This checks that the hash values stored in the database control table still matches, and retrieves the receipt id that was generated from the blockchain
```javascript
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
```
The function prints out the blockchain transaction Id corresponding to the receipt stored in the control table.  
```
***** Validating Hash
checking hash for  { _id: 599546b10b0c115799ee58f4,
  collection: 'Sakila_films',
  db: 'SampleCollections',
  projection: '{}',
  query: '{}',
  hash: '937b39ef759fb1bf84deaa12721d18f085a1afe2927a9de5969c5477110953a2',
  status: 'acknowledged',
  dateTime: 2017-08-18T02:20:10.878Z,
  receipt:
   { '@context': 'https://w3id.org/chainpoint/v2',
     type: 'ChainpointSHA256v2',
     targetHash: '937b39ef759fb1bf84deaa12721d18f085a1afe2927a9de5969c5477110953a2',
     merkleRoot: '836bac4702fa6119bb2363c431d4d8d8b5c5b810e8dc0dea3418c7d207a46a02',
     proof: [ [Object], [Object] ],
     anchors: [ [Object] ] } }
***** Generating hash  hash= 937b39ef759fb1bf84deaa12721d18f085a1afe2927a9de5969c5477110953a2
Hash has not changed
***** Checking hash receipt on the blockchain
***** Reciept is valid
***** See https://blockchain.info/tx/71436bc1b3d3a532f3df2feb9b6e0576ea09eebde1a05f237da8b4bb590d7192
***** For blockchain transaction details
```
If we go to the blockchain.info page we can check that the blockchain transaaction id is what we expect.    The data at blockchain.info is proof that the database document hashes were valid at the time at which the block was added to the blockchain.  If the hash value is the same now as it was then we can be confident that the documents have not been changed. 