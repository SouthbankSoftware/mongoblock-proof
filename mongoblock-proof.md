# Sealing MongoDB documents on the blockchain
As human beings, we get used to the limitations of the technologies we use and over time forget how fundamental some of these limitations are. As a database administrator in the early 1990s, I remember the shock I felt when I realized that the contents of the database files were plain text; I’d just assumed they were encrypted and could only be modified by the database engine acting on behalf of a validated user.  But I got used to it. I also got used to the idea that the contents of a database where pretty much what I – the DBA – said it was.  Rudimentary audit logs could be put in place to track activity, but as DBA I could easily disable the audit logs and tamper with any database if I so desired. I think it’s obvious to all of us that this is not the way it should be – contents of production databases should be trustworthy,  We should know that a DBA, hacker or privileged user has not tampered with the contents of the database.  However, until recently we lacked the technology to ensure this.However, the emergence of a tamper-proof distributed ledger in the form of the Blockchain now promises to give us a mechanism to at least “seal” database records.  We can’t necessarily stop a hacker or malicious insider from breaking the seal, but we can at least know if the seal has been broken.  In this post, I’ll show how to implement a simple Blockchain seal for MongoDB.  We’ll record a hash value corresponding to a set of documents in a database.  As long as the hash value has not changed, we can be confident that the database records have not been tampered with.  The hash value is stored on the Blockchain so that we can know with certainty that a particular hash value was in effect at a specific point in time. ### SetupI’m using the Tierion service to handle the Blockchain proof of existence processing – you can apply for a free Tierion account at [tierion.com](http://tierion.com). I’m going to step through just the basic steps in this post – you can find the full source code at https://github.com/SouthbankSoftware/mongoblock-proof. 

We setup a connection to Tierion using our username and password.  This returns a token which we can examine, but most importantly for our purposes it initialises the `hashClient` that we'll use in subsequent calls.

```javascript
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
```

### Hashing documents 
We generate a hash for a set of MongoDB documents using the `crypto` package.  This function takes db, collection, filter and projection arguments to determine the set of documents to be returned.  A hash digest is generated for those documents.  Should anyone alter those documents then the hash will no longer be valid.

```javascript
function genHash(db, collection, query, projection) {
    log('Generating hash ');
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
``` 

We store the hash into a control table within the MongoDB database itself.  That part is trivial so I won't show it here.  

### Storing the hash on the blockchain 

Next we call out to Tierion to store that hash on the blockchain.

```javascript
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
```
The sequence of events in this function is as follows:

1. We submit the hash to Tierion using the `submitHashItem` call.  This gives us a receipt id. 
2. We check the status of the receiptId periodically using the `getReceipt call`.  It may take as long as 10 minutes to see our receipt on the block, so we poll every 30 seconds
3. Once we get the updated receipt, we store it into the database record. 

### Validating an existing hash
If we want to see that the database documents have not been tampered with, we call the `checkHash` function, using the query filters that we originally used to create the hash in the first place.  This checks that the hash values stored in the database control table still match, and retrieves the receipt id that was generated from the blockchain.  For demonstration purposes, the sample program validates the hash immediately. 

```javascript
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
```
Here is the output from running the program on some sample data:

```
node mongoHash.js -u localhost:27016/SampleCollections -U 'guy.harrison@outlook.com' -P 'DBEnvy2016' -c Sakila_actors -q {} -p {}
Guy15in-MacBook:mongoblock-proof gharriso$ bash mongoblock-proof.sh
bash: mongoblock-proof.sh: No such file or directory
Guy15in-MacBook:mongoblock-proof gharriso$ bash mongoHash.sh
Wed Sep 13 2017 17:16:39 GMT+1000 (AEST) Authenticating with Tierion
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) Authentiation success
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) Checking DB tables
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) Generating hash
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) hash= 66647a3cdd586ebc4788bb0ec2ac1ac658ee522ca91fcaf18fc11a83a7d15ca8
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) hash=66647a3cdd586ebc4788bb0ec2ac1ac658ee522ca91fcaf18fc11a83a7d15ca8
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) Writing hash to database
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) {"db":"SampleCollections","collection":"Sakila_actors","query":"{}","projection":"{}"}
Wed Sep 13 2017 17:16:45 GMT+1000 (AEST) registering hash in blockchain
Wed Sep 13 2017 17:16:52 GMT+1000 (AEST) receipt id
Wed Sep 13 2017 17:16:52 GMT+1000 (AEST) Waiting for confirmation
Wed Sep 13 2017 17:17:22 GMT+1000 (AEST) checking...
Wed Sep 13 2017 17:17:26 GMT+1000 (AEST) {"error":"Receipt with Id = 59b8db6401647049021f9391 has not been generated. The block has not yet been processed."}
nerated. The block has not yet been processed."}
Wed Sep 13 2017 17:20:22 GMT+1000 (AEST) checking...
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) Tierion returns
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) Updating DB with receipt
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) {"db":"SampleCollections","collection":"Sakila_actors","query":"{}","projection":"{}"}
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) Validating Hash
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) Generating hash
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) hash= 66647a3cdd586ebc4788bb0ec2ac1ac658ee522ca91fcaf18fc11a83a7d15ca8
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) Hash has not changed
Wed Sep 13 2017 17:20:26 GMT+1000 (AEST) Checking hash receipt on the blockchain
Wed Sep 13 2017 17:20:32 GMT+1000 (AEST) Reciept is valid
Wed Sep 13 2017 17:20:32 GMT+1000 (AEST) See "https://blockchain.info/tx/68686155addca8b3fc0f3077867a8ed3f588afb550a1f751702eef8c3bd76879
Wed Sep 13 2017 17:20:32 GMT+1000 (AEST) For blockchain transaction details
Wed Sep 13 2017 17:20:32 GMT+1000 (AEST) Looking up blockchain transaction
Wed Sep 13 2017 17:20:38 GMT+1000 (AEST) Blockchain entry is at
Wed Sep 13 2017 17:20:38 GMT+1000 (AEST) this is Wed Sep 13 2017 17:20:00 GMT+1000 (AEST) for you humans
Wed Sep 13 2017 17:20:38 GMT+1000 (AEST) Hash on database document is
Wed Sep 13 2017 17:20:38 GMT+1000 (AEST) Difference between timestamps :-26.773 seconds
```
If we go to the blockchain.info page we can check that the blockchain transaaction id is what we expect.    The data at blockchain.info is proof that the database document hashes were valid at the time at which the block was added to the blockchain.  If the hash value is the same now as it was then we can be confident that the documents have not been changed. 

## Conclusion

I believe that eventually all critical database systems will need to be equiped with built in mechanisms to "seal" database records on the blockchain.  But for now, we can get some of the way there using existing APIs together with a bit of duct tape and JavaScript code :-) 

Try out [dbKoda](http://dbKoda.com) - an open source, free IDE now available for MongoDB!