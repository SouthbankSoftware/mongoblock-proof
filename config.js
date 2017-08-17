module.exports = {
    tierion: {
        client_secret: '8844d38c3c647fa513ea0681ade77f54853d593a',
        username: 'guy.harrison@output.com',
        password: 'DBEnvy2016'
    },

    pubnub: {
        ssl           : false,  
        publish_key   : 'pub-c-xxxxx-xxx-xxxx-xxxx-xxxx',
        subscribe_key : 'sub-c-xxxxxx-xxxx-xxx-xxxx-xxx',
        registered_channel: 'registered_channel',
        confirmed_channel: 'confirmed_channel'
    },

    url: 'http://xxxxxxxx.ngrok.io',

    db: 'existence',

    port: process.env.APP_PORT || 3000
};